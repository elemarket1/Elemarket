import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { enforceRateLimit, rateLimitResponse } from "@/lib/security/rate-limit.server";

export const Route = createFileRoute("/api/mobile/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try { await enforceRateLimit("mobile-catalog", { windowSeconds: 60, maxRequests: 90 }); }
        catch (error) { const limited = rateLimitResponse(error); if (limited) return limited; throw error; }
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_\\]/g, "\\$&");
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30) || 30, 1), 40);
        const sql = await getSql();
        const rows = await sql.query<{
          id: string; merchant_id: string; merchant_name: string; name: string; category: string;
          price: string; stock: number; image_path: string | null; city: string; description: string;
        }>(
          `select p.id,p.merchant_id,m.name merchant_name,p.name,p.category,p.price::text price,p.stock,p.image_path,m.city,p.description
             from products p join merchants m on m.id=p.merchant_id
            where m.status='active' and m.verified=true and p.status='active' and p.stock>0
              and ($1::text='' or p.name ilike '%'||$1||'%' escape '\\' or m.name ilike '%'||$1||'%' escape '\\')
            order by p.name limit $2`,
          [q, limit],
        );
        return Response.json({ products: rows });
      },
    },
  },
});
