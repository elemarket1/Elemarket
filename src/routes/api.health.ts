import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { getElemarketEnvironment } from "@/lib/env.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sql = await getSql();
          await sql.query("select 1 as ok");
          return Response.json(
            { ok: true, environment: getElemarketEnvironment() },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return Response.json(
            { ok: false },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
