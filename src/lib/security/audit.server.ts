import { getSql } from "@/lib/db";

export type AuditRole = "customer" | "merchant" | "admin" | "system";
export type AuditOutcome = "success" | "denied" | "failed";

export async function recordAuditEvent(input: {
  eventType: string;
  resourceType: string;
  resourceId?: string | null;
  actorUserId?: string | null;
  actorRole?: AuditRole | null;
  requestId?: string | null;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `select record_audit_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      input.eventType,
      input.resourceType,
      input.resourceId ?? null,
      input.actorUserId ?? null,
      input.actorRole ?? null,
      input.requestId ?? null,
      input.outcome ?? "success",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
