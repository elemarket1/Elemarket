import { publicHttpsFetch } from "@/lib/security/ssrf.server";
import { getSql } from "@/lib/db";
import { structuredLog } from "@/lib/observability/logger.server";

type SecurityAlert = {
  alertKey: string;
  severity: "warn" | "error" | "critical";
  eventName: string;
  message: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
};

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export async function emitSecurityAlert(alert: SecurityAlert): Promise<void> {
  structuredLog(alert.severity === "critical" ? "error" : alert.severity, "security.alert", { metadata: { alertKey: alert.alertKey, severity: alert.severity, eventName: alert.eventName, message: alert.message, ...(alert.metadata ?? {}) } });
  try {
    const sql = await getSql();
    await sql.query(`select record_security_alert($1,$2,$3,$4,$5::jsonb,$6)`, [
      alert.alertKey,
      alert.severity,
      alert.eventName,
      alert.message,
      JSON.stringify(alert.metadata ?? {}),
      alert.dedupeKey ?? null,
    ]);
  } catch (error) {
    structuredLog("error", "security.alert.persistence_failed", {
      metadata: { alertKey: alert.alertKey, error: error instanceof Error ? error.message : String(error) },
    });
  }

  // Optional generic alert sink. Keep the payload deliberately free of secrets,
  // credentials, tokens, payment payloads, and customer PII.
  const webhook = process.env.ELEMARKET_SECURITY_ALERT_WEBHOOK_URL?.trim();
  if (!webhook || !isHttpsUrl(webhook)) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await publicHttpsFetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: "elemarket", timestamp: new Date().toISOString(), alertKey: alert.alertKey, severity: alert.severity, eventName: alert.eventName }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    structuredLog("warn", "security.alert.webhook_failed", {
      metadata: { alertKey: alert.alertKey, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
