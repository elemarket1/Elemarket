import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getResponseHeaders, setResponseHeaders } from "@tanstack/react-start/server";
import { securityHeaders } from "@/lib/security/headers";
import { structuredLog } from "@/lib/observability/logger.server";

function createCspNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

const requestLoggingMiddleware = createMiddleware().server(async ({ request, next }) => {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id")?.trim().slice(0, 128) || crypto.randomUUID();
  const path = url.pathname;

  structuredLog("info", "http.request.started", {
    requestId,
    metadata: { method: request.method, path },
  });

  try {
    const result = await next();
    structuredLog(result.response.status >= 500 ? "error" : result.response.status >= 400 ? "warn" : "info", "http.request.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      metadata: { method: request.method, path, status: result.response.status },
    });
    return result;
  } catch (error) {
    structuredLog("error", "http.request.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      metadata: {
        method: request.method,
        path,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const securityMiddleware = createMiddleware().server(({ next }) => {
  const cspNonce = createCspNonce();
  const headers = getResponseHeaders();
  const configuredHeaders = securityHeaders({ production: true, nonce: cspNonce });

  for (const [key, value] of Object.entries(configuredHeaders)) headers.set(key, value);
  setResponseHeaders(headers);

  return next({
    context: { cspNonce },
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestLoggingMiddleware, csrfMiddleware, securityMiddleware],
}));
