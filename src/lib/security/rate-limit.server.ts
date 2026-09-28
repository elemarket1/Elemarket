import { publicHttpsFetch } from "@/lib/security/ssrf.server";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { emitSecurityAlert } from "@/lib/observability/security-alert.server";
import { nativeRedisRateLimit, supportsNativeRedisUrl } from "@/lib/security/native-redis-rate-limit.server";

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfter: number;
  readonly remaining: number;
  constructor(retryAfter: number, remaining = 0) {
    super("Too many requests");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.remaining = remaining;
  }
}

function clientAddress(request: Request): string {
  // Behind a trusted reverse proxy, x-forwarded-for's first value is the
  // originating client. Otherwise use the direct address when available.
  const trustProxy = process.env.ELEMARKET_TRUST_PROXY === "1" || process.env.VERCEL === "1";
  if (trustProxy) {
    // Shared-environment startup requires ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR=1.
    // Prefer a proxy-supplied canonical client address and never fall back to an
    // arbitrary client-controlled header when the proxy contract is enabled.
    // On Vercel, x-vercel-forwarded-for is the platform identity and is
    // equivalent to x-forwarded-for. Prefer it so an additional proxy cannot
    // accidentally change the rate-limit identity. When using an explicit
    // trusted proxy, x-forwarded-for is accepted only under the startup contract
    // that the proxy overwrites it rather than appending client input.
    const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.trim();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
    if (process.env.VERCEL === "1" && vercelForwarded && isIP(vercelForwarded)) return vercelForwarded;
    if (forwarded && isIP(forwarded)) return forwarded;
    throw new Error("Trusted proxy did not provide a client IP");
  }
  // A shared deployment must never collapse anonymous traffic into one bucket.
  // If no trustworthy platform/proxy identity is available, fail closed so the
  // caller cannot accidentally turn the limiter into a global DoS primitive.
  if (process.env.ELEMARKET_ENV === "production" || process.env.ELEMARKET_ENV === "staging") {
    throw new Error("Trusted client-IP source is required for shared-environment rate limiting");
  }
  // In shared deployments this branch is unreachable because startup requires a
  // trusted platform/proxy contract. Keep the direct identity literal for the
  // local-development fallback only.
  return "direct";
}

function bucketKey(scope: string, request: Request, subject?: string, identity: "ip" | "subject" = "ip"): string {
  if (identity === "subject" && !subject) throw new Error("A subject-wide limit requires a subject");
  const address = identity === "subject" ? "subject-wide" : clientAddress(request);
  const raw = `${scope}\n${address}\n${subject ?? ""}`;
  return createHash("sha256").update(raw).digest("hex");
}

export async function enforceRateLimit(
  scope: string,
  options: { windowSeconds: number; maxRequests: number; subject?: string; identity?: "ip" | "subject" },
): Promise<{ remaining: number; resetAt: number }> {
  const request = getRequest();
  if (!request) return { remaining: options.maxRequests, resetAt: 0 };
  const key = bucketKey(scope, request, options.subject, options.identity);
  let result: { allowed: boolean; remaining: number; resetAt: number } | undefined;

  // Prefer a native Redis/Valkey connection on Render and other native Redis deployments.
  // HTTPS REST remains supported for Upstash-style endpoints. PostgreSQL is the durable fallback.
  const redisUrl = process.env.REDIS_URL?.trim();
  const redisToken = process.env.REDIS_HTTP_TOKEN?.trim();
  if (redisUrl && supportsNativeRedisUrl(redisUrl)) {
    try {
      const { count, ttl } = await nativeRedisRateLimit(key, options.windowSeconds, redisUrl);
      result = { allowed: count <= options.maxRequests, remaining: Math.max(0, options.maxRequests - count), resetAt: Math.floor(Date.now() / 1000) + ttl };
    } catch {
      // Fall through to PostgreSQL so a Redis outage does not become a marketplace outage.
    }
  } else if (redisUrl?.startsWith("https://") && redisToken) {
    try {
      const script = `local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; local ttl=redis.call('TTL',KEYS[1]); return {c,ttl}`;
      const response = await publicHttpsFetch(redisUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${redisToken}` },
        body: JSON.stringify({ command: ["EVAL", script, "1", key, String(options.windowSeconds)] }),
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) {
        const body = await response.json() as { result?: [number|string, number|string] };
        const count = Number(body.result?.[0]);
        const ttl = Number(body.result?.[1]);
        if (Number.isFinite(count) && Number.isFinite(ttl) && ttl >= 0) {
          result = { allowed: count <= options.maxRequests, remaining: Math.max(0, options.maxRequests - count), resetAt: Math.floor(Date.now() / 1000) + ttl };
        }
      }
    } catch {
      // Fall through to PostgreSQL so a Redis outage does not become a marketplace outage.
    }
  }

  if (!result) {
    const sql = await getSql();
    const rows = await sql.query<{ result: { allowed: boolean; remaining: number; resetAt: number } }>(
      `select consume_api_rate_limit($1,$2,$3) as result`,
      [key, options.windowSeconds, options.maxRequests],
    );
    result = rows[0]?.result;
  }
  if (!result?.allowed) {
    const retryAfter = Math.max(1, Math.ceil(Number(result?.resetAt ?? 0) - Date.now() / 1000));
    void emitSecurityAlert({
      alertKey: "rate-limit-block",
      severity: "warn",
      eventName: "security.rate_limit_blocked",
      message: "A request was blocked by an application rate limit.",
      metadata: { scope },
      dedupeKey: `${scope}:${key}`,
    });
    throw new RateLimitError(retryAfter, Number(result?.remaining ?? 0));
  }
  return { remaining: Number(result.remaining), resetAt: Number(result.resetAt) };
}

export function rateLimitResponse(error: unknown): Response | null {
  if (!(error instanceof RateLimitError)) return null;
  return new Response("Too many requests", {
    status: error.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(error.retryAfter),
      "x-ratelimit-remaining": String(error.remaining),
    },
  });
}
