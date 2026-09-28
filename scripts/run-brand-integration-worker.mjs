import { signedWorkerRequest } from "./internal-worker-request.mjs";

try {
  const origin = process.env.ELEMARKET_PUBLIC_URL?.trim();
  if (!origin) throw new Error("ELEMARKET_PUBLIC_URL is required");
  const request = signedWorkerRequest(
    new URL("/api/internal/brand-integration-worker", origin),
    process.env.ELEMARKET_ENTERPRISE_SYNC_SECRET,
  );
  const response = await fetch(request, { signal: AbortSignal.timeout(60_000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
  console.log("Brand integration worker completed");
} catch (error) {
  // Never print signed headers or provider response bodies.
  console.error(error instanceof Error ? error.message : "Worker invocation failed");
  process.exitCode = 1;
}
