import { getSql } from "@/lib/db";
import { getEmailAdapter } from "./registry.server";
export async function handleEmailWebhook(payload: string, headers: Headers) {
  const adapter = getEmailAdapter();
  if (!adapter.parseAuthenticatedWebhook) throw new Error("Email provider lacks authenticatedWebhook capability");
  const event = await adapter.parseAuthenticatedWebhook(payload, headers);
  const sql = await getSql();
  await sql.query(
    `insert into email_events(id,event_type,email_id,recipient,subject,payload,created_at)
     values($1,$2,$3,$4,$5,$6::jsonb,coalesce($7::timestamptz,now())) on conflict (id) do nothing`,
    [`${adapter.key}:${event.id}`, event.type, event.emailId, event.recipient, event.subject, payload, event.createdAt]);
  return { accepted: true as const, eventId: event.id };
}
