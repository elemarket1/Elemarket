import { getSql } from "@/lib/db";
import { getPaymentAdapter } from "@/lib/market/adapters/registry";
import { recordMetric } from "@/lib/observability/logger.server";
import { requireFreshSession } from "@/lib/auth/verify.server";
import { requireAdminForUserId } from "@/lib/auth/authorization.server";

type RefundRequest = {
  id: string;
  payment_id: string;
  order_id: string;
  provider_key: string;
  provider_reference: string;
  provider_refund_id: string | null;
  amount: string;
  currency: string;
  customer_note: string | null;
  merchant_note: string | null;
  status: "requested" | "processing" | "needs_attention" | "processed" | "failed";
};

async function executeProviderRefundForActor(input: { requestId: string; actorId: string | null }) {
  const sql = await getSql();
  const actor = await sql.query<{ role: string; requested_by: string | null; reason: string }>(
    `
    select u.role, r.requested_by, r.reason
      from provider_refund_requests r
      left join "user" u on u.id=$2
     where r.id=$1
     limit 1
  `,
    [input.requestId, input.actorId],
  );
  if (!actor[0]) throw new Error("Refund request not found");
  if (input.actorId === null ? (actor[0].reason !== "late_successful_payment" || actor[0].requested_by !== null) : (actor[0].role !== "admin" && actor[0].requested_by !== input.actorId)) {
    throw new Error("Refund request is not authorized for this actor");
  }
  // Unknown outcomes require provider reconciliation, not another outbound refund.
  // Only a fresh request or an explicitly prepared provider-confirmed failure is claimable.
  const claimed = await sql.query<RefundRequest>(
    `
    update provider_refund_requests
       set status='processing', updated_at=now()
     where id=$1 and status='requested'
     returning *
  `,
    [input.requestId],
  );
  const request = claimed[0];
  if (!request) {
    const existing = await sql.query<RefundRequest>(
      `select * from provider_refund_requests where id=$1 limit 1`,
      [input.requestId],
    );
    const row = existing[0];
    if (!row) throw new Error("Refund request not found");
    if (
      row.status === "processed" ||
      row.status === "processing" ||
      row.status === "needs_attention"
    )
      return { requestId: row.id, status: row.status, providerRefundId: row.provider_refund_id };
    throw new Error("Refund request is not executable");
  }

  let result;
  try {
    const bindings = await sql.query<{ driver_key: string }>(
      `select p.driver_key from payments p join orders o on o.id=p.order_id and o.user_id=p.user_id
        where p.id=$1 and p.order_id=$2 and p.provider_key=$3 and p.provider_reference=$4
          and p.amount=$5 and p.currency=$6 and p.status='completed'`,
      [request.payment_id, request.order_id, request.provider_key, request.provider_reference, request.amount, request.currency],
    );
    if (!bindings[0]?.driver_key) throw new Error("Refund payment driver/binding is unavailable");
    const adapter = await getPaymentAdapter(request.provider_key, bindings[0].driver_key);
    if (!adapter.capabilities.refund || !adapter.refundPayment)
      throw new Error("Configured payment provider does not support refunds");
    result = await adapter.refundPayment({
      providerReference: request.provider_reference,
      amount: String(request.amount),
      currency: request.currency,
      customerNote: request.customer_note ?? undefined,
      merchantNote: request.merchant_note ?? undefined,
      idempotencyKey: `refund:${request.id}`,
    });
  } catch (error) {
    // A transport failure is not proof that the PSP rejected the refund. Keep it
    // in needs_attention so an operator/reconciliation worker cannot accidentally
    // issue a second refund for the same payment.
    await sql.query(
      `update provider_refund_requests set status='needs_attention', provider_response=$1::jsonb, updated_at=now() where id=$2 and status='processing'`,
      [
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "provider refund request could not be confirmed",
        }),
        request.id,
      ],
    );
    throw error;
  }

  const persisted = await sql.query<RefundRequest>(
    `select * from persist_provider_refund_result($1,$2,$3,$4::jsonb)`,
    [request.id, result.status, result.providerRefundId, JSON.stringify(result.metadata ?? {})],
  );
  // A provider webhook may have resolved the refund while the HTTP call was in flight.
  // Return durable state and never replace it with an older provider response.
  const current =
    persisted[0] ??
    (
      await sql.query<RefundRequest>(`select * from provider_refund_requests where id=$1 limit 1`, [
        request.id,
      ])
    )[0];
  if (!current) throw new Error("Refund request not found");
  await recordMetric("payment.refund.requested", {
    entityId: request.payment_id,
    metadata: {
      providerKey: request.provider_key,
      status: current.status,
      providerRefundId: current.provider_refund_id,
    },
  });
  return {
    requestId: request.id,
    status: current.status,
    providerRefundId: current.provider_refund_id,
  };
}

/** Public financial boundary: resolve the actor from the authenticated session. */
export async function executeProviderRefundAsAuthenticatedUser(requestId: string) {
  const actorId = await requireFreshSession();
  const sql = await getSql();
  const rows = await sql.query<{ role: string }>(`select role from "user" where id=$1 limit 1`, [
    actorId,
  ]);
  if (rows[0]?.role === "admin") {
    await requireAdminForUserId(actorId);
  }
  return executeProviderRefundForActor({ requestId, actorId });
}

/** Explicit admin-only financial boundary. Never accept a caller-supplied actor ID. */
export async function executeProviderRefundAsAdmin(requestId: string) {
  const actorId = await requireFreshSession();
  await requireAdminForUserId(actorId);
  return executeProviderRefundForActor({ requestId, actorId });
}

/** Internal webhook reconciliation. No caller-supplied identity or refund amount. */
export async function executeLatePaymentRefund(providerKey: string, providerReference: string) {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `select r.id from provider_refund_requests r
      join payments p on p.id=r.payment_id and p.order_id=r.order_id
      join orders o on o.id=r.order_id and o.user_id=p.user_id
      where r.provider_key=$1 and r.provider_reference=$2 and r.reason='late_successful_payment'
        and r.requested_by is null and o.status='cancelled'
        and exists(select 1 from payment_provider_evidence e where e.payment_id=p.id and e.provider_reference=$2)
      limit 1`, [providerKey, providerReference]);
  if (rows[0]) return executeProviderRefundForActor({ requestId: rows[0].id, actorId: null });
}
