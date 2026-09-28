import { createFileRoute } from "@tanstack/react-router";
import { syncAllEnterpriseCatalogs } from "@/lib/market/enterprise-catalog.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { authorizeInternalHmacRequest } from "@/lib/security/internal-job-auth.server";

async function assertCronAuthorization(request: Request): Promise<void> {
  if (!(await authorizeInternalHmacRequest(request, process.env.CRON_SECRET, process.env.CRON_SECRET))) {
    throw new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }
}

export const Route = createFileRoute("/api/internal/sync-enterprise-catalogs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await assertCronAuthorization(request);
        await enforceRateLimit("internal-sync-enterprise-catalogs", { windowSeconds: 60, maxRequests: 2 });
        try {
          const results = await syncAllEnterpriseCatalogs();
          return Response.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
        } catch {
          return new Response("Enterprise catalog scheduler failed", { status: 500, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
