import { getSql } from "@/lib/db";

/** Customer-visible outcome must reflect fulfilment eligibility, not charge evidence alone. */
export async function customerPaymentOutcome(paymentId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{ payment_id: string; order_id: string; status: string; order_status: string; provider_reference: string | null; reconciliation_required: boolean }>(
    `select p.id as payment_id,o.id as order_id,
       case when p.status='refunded' then 'refunded'
         when o.status='cancelled' and p.status='completed' then 'reconciliation_required'
         when o.status='cancelled' or (o.status='payment_pending' and o.payment_deadline<=now()) then 'cancelled'
         when o.status in ('refund_pending','disputed') then o.status
         else p.status end as status,
       o.status as order_status,p.provider_reference,
       (o.status='cancelled' and p.status='completed') as reconciliation_required
     from payments p join orders o on o.id=p.order_id and o.user_id=p.user_id
     where p.id=$1 and p.user_id=$2`, [paymentId,userId]);
  const row=rows[0];
  if (!row) throw new Error("Payment not found");
  return { paymentId: row.payment_id, orderId: row.order_id, status: row.status,
    orderStatus: row.order_status, providerReference: row.provider_reference, reconciliationRequired: row.reconciliation_required };
}
