import { getSql } from "@/lib/db";
import { requireCustomerPayment } from "@/lib/market/ownership.server";
import { getPaymentAdapter } from "@/lib/market/adapters/registry";
import { recordMetric } from "@/lib/observability/logger.server";
import { emitSecurityAlert } from "@/lib/observability/security-alert.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { normalizeProviderKey } from "@/lib/market/provider-policy.server";
import { env, getElemarketEnvironment } from "@/lib/env.server";
import { PaymentProviderError, PaymentWebhookError } from "@/lib/market/payment-errors";

export type PaymentStatus = "initiated" | "authorized" | "completed" | "failed" | "refunded";

function validateProviderCheckoutUrl(value: string | undefined, providerKey: string, defaultHosts: readonly string[]): string | undefined {
  if (!value) return undefined;
  try {
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
      if (getElemarketEnvironment() === "development" || getElemarketEnvironment() === "preview") return value;
      throw new Error("Provider checkout URL must be absolute HTTPS in shared environments");
    }
    const url = new URL(value);
    if (url.protocol === "https:") {
      if (url.username || url.password || url.hash || (url.port && url.port !== "443")) {
        throw new Error("Unsafe provider checkout URL");
      }
    } else {
      throw new Error("Provider checkout URL must use HTTPS");
    }
    const envKey = `ELEMARKET_PAYMENT_${providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CHECKOUT_HOSTS`;
    const configuredHosts = (process.env[envKey] ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    const allowedHosts = configuredHosts.length ? configuredHosts : defaultHosts;
    if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new Error("Provider checkout host is not approved");
    return url.toString();
  } catch {
    throw new Error("Provider returned an unsafe checkout URL");
  }
}

/** Provider adapter boundary. No provider is considered configured merely by being listed in the DB. */
export async function createExternalPaymentIntent(input: { paymentId: string; providerKey?: string; userId: string }) {
  const sql = await getSql();
  const owned = await requireCustomerPayment(input.paymentId, input.userId);
  const payment = {
    payment_id: owned.id,
    order_id: owned.order_id,
    amount: owned.amount,
    currency: owned.currency,
    method: owned.method,
    status: owned.status as PaymentStatus,
    provider_key: owned.provider_key,
  };
  const selectedProviderKey = input.providerKey ?? payment.provider_key;
  if (!selectedProviderKey) throw new Error("Payment provider is not selected");
  const normalizedProviderKey = normalizeProviderKey(selectedProviderKey);
  if (payment.status !== "initiated") throw new Error("Payment is not startable");
  if (payment.provider_key !== normalizedProviderKey) throw new Error("Payment provider mismatch");

  const provider = await sql.query<{ provider_key: string; driver_key: string | null; requires_merchant_account: boolean }>(
    `select pp.provider_key, p.driver_key, pp.requires_merchant_account from payment_providers pp join payments p on p.provider_key=pp.provider_key where pp.provider_key = $1 and pp.method = $2 and pp.status = 'active' and p.id=$3`,
    [normalizedProviderKey, payment.method, payment.payment_id],
  );
  if (!provider[0]) throw new Error("Payment provider is not configured for production");

  const adapter = await getPaymentAdapter(normalizedProviderKey, provider[0].driver_key ?? undefined);
  if (getElemarketEnvironment() === "production" && !adapter.capabilities.deliveryDisputeHold) throw new Error("Payment provider lacks required deliveryDisputeHold capability");
  if (!adapter.capabilities.currencies.includes(payment.currency) || !adapter.capabilities.methods.includes(payment.method)) throw new Error("Payment provider does not support this currency/method");
  const attemptRows = await sql.query<{ result: { paymentId: string; attemptId: string; attemptNo: number; status: "initiated" | "pending" | "authorized"; existing?: boolean; providerReference?: string | null; checkoutUrl?: string | null } }>(
    `select create_payment_attempt($1,$2,$3,$4,$5::jsonb) as result`,
    [payment.payment_id, normalizedProviderKey, payment.amount, payment.currency, JSON.stringify({ configured: true })],
  );
  const result = attemptRows[0]?.result;
  if (!result) throw new Error("Payment attempt could not be created");
  if (result.existing && result.providerReference && result.checkoutUrl) {
    return { ...result, providerReference: result.providerReference, checkoutUrl: validateProviderCheckoutUrl(result.checkoutUrl, normalizedProviderKey, adapter.checkoutHosts) };
  }
  if (!adapter.capabilities.idempotentInitialization) {
    throw new Error("Payment provider does not support duplicate-safe initialization");
  }
  const expectedReference = adapter.initializationReference?.(result.attemptId);
  const claimToken = crypto.randomUUID();
  const claimed = await sql.query<{ id: string }>(
    `update payment_attempts
        set initiation_token=$2, initiation_expires_at=now()+interval '2 minutes', provider_reference=coalesce(provider_reference,$3), updated_at=now()
      where id=$1 and checkout_url is null and status in ('initiated','pending')
        and (initiation_token is null or initiation_expires_at < now())
      returning id`,
    [result.attemptId, claimToken, expectedReference ?? null],
  );
  if (!claimed[0]) {
    return { ...result, status: "pending", initializing: true, checkoutUrl: null };
  }
  // An attempt can exist briefly without a provider reference while the external
  // provider call is in flight. Reuse the same attempt/idempotency key instead of
  // creating another charge. This also closes the pay-then-cancel race window.
  const customerRows = await sql.query<{ email: string }>(`select email from "user" where id=$1 limit 1`, [input.userId]);
  const customerEmail = customerRows[0]?.email?.trim();
  if (!customerEmail) throw new Error("Customer email is required for payment");
  const subaccountRows = await sql.query<{ provider_account_ref: string }>(`select provider_account_ref from merchant_payment_accounts where merchant_id=(select merchant_id from orders where id=$1) and provider_key=$2 and status='active' limit 1`, [payment.order_id,normalizedProviderKey]);
  if ((provider[0].requires_merchant_account || adapter.capabilities.merchantAccount) && !subaccountRows[0]?.provider_account_ref) throw new Error("Merchant provider account is not configured");
  const publicUrl = env("ELEMARKET_PUBLIC_URL");
  const callbackUrl = publicUrl ? `${publicUrl.replace(/\/$/, "")}/payment/return?paymentId=${encodeURIComponent(result.paymentId)}` : undefined;
  const external = await adapter.createPayment({ paymentId:result.paymentId, attemptId:result.attemptId, amount:String(payment.amount), currency:payment.currency, method:payment.method, customerEmail, merchantSubaccount:subaccountRows[0]?.provider_account_ref, idempotencyKey: result.attemptId, callbackUrl });
  if (expectedReference && external.providerReference !== expectedReference) throw new Error("Provider initialization reference mismatch");
  const safeCheckoutUrl = validateProviderCheckoutUrl(external.checkoutUrl, normalizedProviderKey, adapter.checkoutHosts);
  const bound = await sql.query(`update payment_attempts set provider_reference=$1, checkout_url=$2, status=case when status in ('cancelled','completed','failed','authorized') then status else $3 end, metadata=$4::jsonb, initiation_token=null, initiation_expires_at=null, updated_at=now() where id=$5 and initiation_token=$6 returning id`, [external.providerReference, safeCheckoutUrl ?? null, external.status, JSON.stringify(external.metadata ?? {}), result.attemptId, claimToken]);
  if (!bound[0]) {
    // The lease was lost while the provider call was in flight. Do not mutate
    // another request's attempt; the deterministic provider reference remains
    // recoverable through provider verification/reconciliation.
    throw new Error("Payment initiation lease lost before provider binding");
  }
  await sql.query(`update payments set provider_reference=coalesce(provider_reference,$1), updated_at=now() where id=$2 and status='initiated'`, [external.providerReference, payment.payment_id]);
  await recordMetric("payment.attempt.created", { userId: input.userId, entityId: input.paymentId, metadata: { providerKey: normalizedProviderKey, status: external.status } });
  return { ...result, status: external.status, providerReference: external.providerReference, checkoutUrl: safeCheckoutUrl };
}


export async function handlePaymentWebhook(input: { providerKey?: string; rawBody: string; signature: string | null; headers?: Headers }) {
  if (input.rawBody.length > 1024 * 1024) {
    throw new PaymentWebhookError("Webhook payload too large", { status: 413, retryable: false });
  }

  const sql = await getSql();
  const requestedProviderKey = input.providerKey?.trim() || undefined;
  if (requestedProviderKey && !/^[A-Za-z0-9_-]{2,64}$/.test(requestedProviderKey)) {
    throw new PaymentWebhookError("Invalid provider", { status: 400, retryable: false });
  }

  const providerRows = await sql.query<{
    provider_key: string;
    driver_key: string | null;
  }>(
    `select provider_key, driver_key
       from payment_providers
      where status='active'
      order by provider_key`,
  );
  if (!providerRows.length) {
    throw new PaymentWebhookError("No active payment provider is configured", { status: 503, retryable: true });
  }

  const candidates = requestedProviderKey
    ? [
        ...providerRows.filter((row) => row.provider_key === normalizeProviderKey(requestedProviderKey)),
        ...providerRows.filter((row) => row.provider_key !== normalizeProviderKey(requestedProviderKey)),
      ]
    : providerRows;

  const verifiedProviders: Array<{
    provider_key: string;
    driver_key: string | null;
    adapter: Awaited<ReturnType<typeof getPaymentAdapter>>;
  }> = [];

  for (const row of candidates) {
    const adapter = await getPaymentAdapter(row.provider_key, row.driver_key ?? undefined);
    if (!adapter.verifyWebhook || !adapter.parseWebhook) continue;
    try {
      if (await adapter.verifyWebhook(input.rawBody, input.headers ? adapter.webhookSignature?.(input.headers) ?? input.signature : input.signature)) {
        verifiedProviders.push({ ...row, adapter });
      }
    } catch {
      // A malformed/untrusted webhook must not reveal provider configuration.
    }
  }

  if (verifiedProviders.length !== 1) {
    void emitSecurityAlert({
      alertKey: "webhook-provider-resolution",
      severity: "error",
      eventName: "security.payment_webhook_provider_resolution_failed",
      message: "Payment webhook did not resolve to exactly one active provider.",
      metadata: { candidateCount: candidates.length, verifiedProviderCount: verifiedProviders.length },
    });
    throw new PaymentWebhookError(
      verifiedProviders.length > 1 ? "Ambiguous webhook signature" : "Invalid webhook signature",
      { status: 401, retryable: false },
    );
  }

  const provider = verifiedProviders[0];
  const normalizedProviderKey = normalizeProviderKey(provider.provider_key);

  // Rate-limit after cryptographic provider resolution so a caller cannot select
  // an arbitrary provider bucket by changing a query parameter/header.
  await enforceRateLimit(`payment-webhook:${normalizedProviderKey}`, { windowSeconds: 60, maxRequests: 120 });

  if (!provider.adapter.parseWebhook) {
    throw new PaymentWebhookError("Provider webhook parsing is not supported", { status: 503, retryable: true });
  }
  let body;
  try { body = await provider.adapter.parseWebhook(input.rawBody); }
  catch { throw new PaymentWebhookError("Invalid provider webhook payload", { status: 400, retryable: false }); }
  if (!body) return { ignored: true };

  const binding = await sql.query<{ id: string }>(
    `select id from payment_attempts where provider_key=$1 and provider_reference=$2 limit 1`,
    [normalizedProviderKey, body.providerReference],
  );
  if (!binding[0]) {
    throw new PaymentWebhookError("Payment reference is not bound yet", { status: 503, retryable: true });
  }

  if (body.status === "completed") {
    if (!provider.adapter.verifyTransaction) {
      throw new PaymentWebhookError("Provider transaction verification is required for completed payments", { status: 503, retryable: true });
    }
    try {
      const verified = await provider.adapter.verifyTransaction(body.providerReference);
      if (
        verified.status !== "success" ||
        verified.reference !== body.providerReference ||
        verified.currency !== body.currency ||
        Math.abs(verified.amount - body.amount) > 0.001
      ) {
        throw new PaymentWebhookError("Provider transaction verification failed", { status: 400, retryable: false });
      }
    } catch (error) {
      if (error instanceof PaymentWebhookError) throw error;
      if (error instanceof PaymentProviderError) {
        throw new PaymentWebhookError(error.message, { status: error.retryable ? 503 : 502, retryable: error.retryable });
      }
      throw error;
    }
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.rawBody));
  const payloadHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await sql.query<{ result: unknown }>(
    `select apply_payment_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
    [normalizedProviderKey, body.eventId, body.eventType, body.providerReference, body.status, body.amount, body.currency, payloadHash, body.providerRefundId ?? null],
  );
  const result = rows[0]?.result ?? null;
  if (result && typeof result === "object") {
    if ("rejected" in result && result.rejected === true) {
      throw new PaymentWebhookError("Payment webhook rejected", { status: 400, retryable: false });
    }
    if ("retryable" in result && result.retryable === true) {
      throw new PaymentWebhookError("Payment reference is not bound yet", { status: 503, retryable: true });
    }
  }
  // A retry also resumes a durable request left before dispatch by a process crash.
  const { executeLatePaymentRefund } = await import("@/lib/market/refunds.server");
  await executeLatePaymentRefund(normalizedProviderKey, body.providerReference);
  await recordMetric("payment.webhook.processed", {
    entityId: body.providerReference,
    metadata: { providerKey: normalizedProviderKey, eventType: body.eventType, status: body.status },
  });
  return result;
}

export async function completePreviewPaymentServer(input: { paymentId: string; userId: string }) {
  if (getElemarketEnvironment() !== "development" || process.env.ELEMARKET_ENABLE_PREVIEW_SETTLEMENT !== "1") throw new Error("Preview settlement is disabled");
  const owned = await requireCustomerPayment(input.paymentId, input.userId);
  const sql = await getSql();
  const attempts = await sql.query<{ id: string; provider_reference: string | null; provider_key: string; amount: string; currency: string }>(
    `select id, provider_reference, provider_key, amount::text as amount, currency
       from payment_attempts
      where payment_id = $1
      order by attempt_no desc
      limit 1`,
    [owned.id],
  );
  const attempt = attempts[0];
  if (!attempt?.provider_reference) throw new Error("Payment has not been started");
  const eventId = `preview_${attempt.id}_${Date.now()}`;
  const raw = JSON.stringify({ paymentId: owned.id, attemptId: attempt.id, eventId });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const payloadHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await sql.query<{ result: unknown }>(
    `select apply_payment_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
    [attempt.provider_key, eventId, "preview.charge.success", attempt.provider_reference, "completed", Number(attempt.amount), attempt.currency, payloadHash, null],
  );
  await recordMetric("payment.preview.completed", { userId: input.userId, entityId: owned.id });
  return rows[0]?.result ?? { status: "completed", paymentId: owned.id };
}
