import { getSql } from "@/lib/db";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = {
  requestId?: string;
  userId?: string;
  entityId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

function safeJson(value: unknown) {
  try { return JSON.stringify(value); } catch { return JSON.stringify({ serializationError: true }); }
}

export function structuredLog(level: LogLevel, event: string, fields: LogFields = {}) {
  const record = { ts: new Date().toISOString(), service: "elemarket", level, event, ...fields };
  const line = safeJson(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export async function recordMetric(event: string, fields: LogFields = {}) {
  structuredLog("info", event, fields);
  try {
    const sql = await getSql();
    await sql.query(`select record_observability_event($1,$2,$3,$4,$5,$6,$7::jsonb)`, [
      event, "info", fields.requestId ?? null, fields.userId ?? null, fields.entityId ?? null,
      fields.durationMs ?? null, JSON.stringify(fields.metadata ?? {}),
    ]);
    await sql.query(`select increment_observability_counter($1,1)`, [event]);
  } catch (error) {
    structuredLog("warn", "observability.write_failed", { metadata: { event, error: error instanceof Error ? error.message : String(error) } });
  }
}
