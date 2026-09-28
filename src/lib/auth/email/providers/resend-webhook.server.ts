import { createHmac, timingSafeEqual } from "node:crypto";
function decodeSecret(secret: string): Buffer {
  const raw = secret.trim();
  const encoded = raw.startsWith("whsec_") ? raw.slice(6) : raw;
  return Buffer.from(encoded, "base64");
}

function verifySignature(payload: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const signed = `${headers.id}.${headers.timestamp}.${payload}`;
  const expected = createHmac("sha256", decodeSecret(secret)).update(signed).digest();
  return headers.signature.split(" ").some((candidate) => {
    const [version, value] = candidate.split(",", 2);
    if (version !== "v1" || !value) return false;
    try {
      const provided = Buffer.from(value, "base64");
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  });
}

export async function parseResendWebhook(payload: string, requestHeaders: Headers) {
  const headers = { id: requestHeaders.get("svix-id"), timestamp: requestHeaders.get("svix-timestamp"), signature: requestHeaders.get("svix-signature") };
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("RESEND_WEBHOOK_SECRET is not configured");
  if (!verifySignature(payload, headers, secret)) throw new Error("Invalid Resend webhook signature");

  let event: { type?: string; created_at?: string; data?: { email_id?: string; to?: string[]; subject?: string } };
  try { event = JSON.parse(payload); } catch { throw new Error("Invalid Resend webhook JSON"); }
  if (!event.type || !event.data?.email_id) throw new Error("Invalid Resend webhook payload");

  return { id: headers.id!, type: event.type, emailId: event.data.email_id, recipient: event.data.to?.[0] ?? null, subject: event.data.subject ?? null, createdAt: event.created_at ?? null };
}
