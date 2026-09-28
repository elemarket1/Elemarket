import { getSql } from "@/lib/db";
import type { z } from "zod";
import type { searchOrdersSchema, orderSectionInput, SafeRow } from "./orders.schemas";

export async function auditAdminRead(actor: string, order: string | null, section: string) {
  const sql = await getSql();
  await sql.query(
    "select record_audit_event('admin.order.read','order',$1,$2,'admin',null,'success',jsonb_build_object('section',$3::text))",
    [order, actor, section],
  );
}
export async function searchOrders(data: z.infer<typeof searchOrdersSchema>) {
  const sql = await getSql();
  const params: unknown[] = [];
  const clauses: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (data.query) {
    const q = bind(data.query);
    clauses.push(
      {
        order: `o.id=${q}`,
        customer: `o.user_id=${q}`,
        merchant: `o.merchant_id=${q}`,
        payment_reference: `exists(select 1 from payments p where p.order_id=o.id and (p.provider_reference=${q} or exists(select 1 from payment_attempts a where a.payment_id=p.id and a.provider_reference=${q})))`,
      }[data.searchBy],
    );
  }
  for (const [value, column] of [
    [data.status, "o.status"],
    [data.customerId, "o.user_id"],
    [data.merchantId, "o.merchant_id"],
  ])
    if (value) clauses.push(`${column}=${bind(value)}`);
  if (data.from) clauses.push(`o.created_at>=${bind(data.from)}::timestamptz`);
  if (data.to) clauses.push(`o.created_at<=${bind(data.to)}::timestamptz`);
  for (const [value, table] of [
    [data.paymentStatus, "payments"],
    [data.deliveryStatus, "shipments"],
    [data.disputeStatus, "customer_order_disputes"],
    [data.refundStatus, "provider_refund_requests"],
    [data.supportStatus, "support_conversations"],
  ])
    if (value)
      clauses.push(
        `exists(select 1 from ${table} f where f.order_id=o.id and f.status=${bind(value)})`,
      );
  const limit = bind(data.pageSize + 1),
    offset = bind(data.page * data.pageSize);
  const rows = await sql.query<SafeRow>(
    `select o.id,o.status,o.created_at::text as "createdAt",o.currency,o.grand_total::text as total,o.user_id as "customerId",o.merchant_id as "merchantId",m.name as merchant,p.status as "paymentStatus" from orders o join merchants m on m.id=o.merchant_id left join payments p on p.order_id=o.id and p.user_id=o.user_id ${clauses.length ? "where " + clauses.join(" and ") : ""} order by o.created_at desc,o.id desc limit ${limit} offset ${offset}`,
    params,
  );
  return { rows: rows.slice(0, data.pageSize), hasMore: rows.length > data.pageSize };
}
export async function orderOverview(orderId: string) {
  const sql = await getSql();
  const rows = await sql.query<SafeRow>(
    `select o.id,o.group_id as "groupId",o.status,o.created_at::text as "createdAt",o.updated_at::text as "updatedAt",o.payment_deadline::text as "paymentDeadline",coalesce(o.payment_deadline<=now(),false) as "deadlineElapsed",o.currency,o.product_total::text as "productTotal",o.delivery_total::text as "deliveryFee",o.platform_fee::text as commission,o.promo_discount::text as discount,o.grand_total::text as total,o.address as "deliveryAddress",o.delivery_tier as "deliveryTier",o.delivery_confirmation_source as "deliveryConfirmationSource",o.customer_received_at::text as "customerReceivedAt",elemarket_order_delivered_at(o.id)::text as "deliveredAt",o.user_id as "customerId",u.name as "customerName",u."emailVerified" as "emailVerified",case when u."emailVerified" then left(u.email,1)||'***@'||split_part(u.email,'@',2) end as "customerEmail",pr.phone_verified_at::text as "phoneVerifiedAt",case when pr.phone_verified_at is not null then '***'||right(pr.phone,4) end as "customerPhone",o.merchant_id as "merchantId",m.name as "merchantName",m.status as "merchantStatus",m.verified as "merchantVerified",m.address as "merchantAddress",m.city as "merchantCity",m.settlement_model as "settlementModel",p.id as "paymentId",p.status as "paymentStatus",(select status from shipments where order_id=o.id and merchant_id=o.merchant_id order by created_at desc,id desc limit 1) as "deliveryStatus",(select status from customer_order_disputes where order_id=o.id order by created_at desc,id desc limit 1) as "disputeStatus",(select status from provider_refund_requests where order_id=o.id order by requested_at desc,id desc limit 1) as "refundStatus" from orders o join "user" u on u.id=o.user_id join merchants m on m.id=o.merchant_id left join profiles pr on pr.user_id=o.user_id left join payments p on p.order_id=o.id and p.user_id=o.user_id where o.id=$1`,
    [orderId],
  );
  if (!rows[0]) throw new Error("Order unavailable");
  // Explicit policy projection: never expose balances or claim provider-controlled settlement.
  const policy = await sql.query<SafeRow>(
    `select (v->>'eligible')::boolean as eligible,v->>'reason' as reason,v->>'eligibleAt' as "eligibleAt",v->>'deliveredAt' as "deliveredAt",false as "providerSettlementControlled",false as "deliveryHoldGuaranteed" from (select merchant_order_withdrawal_eligibility(merchant_id,id) v from orders where id=$1) s`,
    [orderId],
  );
  return { order: rows[0], withdrawal: policy[0] };
}

// Every projection is allowlisted. No provider payloads, checkout URLs, tokens,
// encrypted merchant documents, audit metadata dumps or arbitrary table names.
export const sectionQueries: Record<z.infer<typeof orderSectionInput>["section"], string> = {
  items: `select i.id::text,i.product_id as "productId",p.name as product,i.variant_id as "variantId",v.name as variant,coalesce(v.sku,p.sku) as sku,i.quantity,i.unit_price::text as "unitPrice",i.original_unit_price::text as "originalUnitPrice",i.product_total::text as subtotal,i.discount_total::text as discount,o.merchant_id as "merchantId",o.status as "fulfilmentStatus",r.status as "reservationStatus",(select sum(commission_amount)::text from order_commission_snapshots c where c.order_id=o.id and c.product_id=i.product_id and c.merchant_id=o.merchant_id) as "productCommission",(select string_agg(distinct s.status,', ') from shipment_items si join shipments s on s.id=si.shipment_id and s.order_id=o.id and s.merchant_id=o.merchant_id where si.order_item_id=i.id) as "shipmentStatus" from orders o join order_items i on i.order_id=o.id join products p on p.id=i.product_id and p.merchant_id=o.merchant_id left join product_variants v on v.id=i.variant_id and v.product_id=i.product_id left join order_stock_reservations r on r.order_item_id=i.id and r.order_id=o.id where o.id=$1 order by i.id`,
  payments: `select coalesce(a.id,p.id) as id,p.id as "paymentId",a.attempt_no as attempt,p.provider_key as provider,p.driver_key as driver,coalesce(a.provider_reference,p.provider_reference) as reference,coalesce(a.status,p.status) as status,p.status as "paymentStatus",coalesce(a.amount,p.amount)::text as amount,coalesce(a.currency,p.currency) as currency,a.created_at::text as "initializedAt",a.updated_at::text as "lastUpdatedAt",a.failure_code as "failureCode",(select min(t.created_at)::text from payment_state_transitions t where t.payment_id=p.id and t.to_status='completed') as "paidAt",(select max(t.created_at)::text from payment_state_transitions t where t.payment_id=p.id and t.to_status='failed') as "failedAt",exists(select 1 from payment_provider_evidence e where e.payment_id=p.id and e.provider_reference=a.provider_reference) as "verifiedEvidence" from payments p left join payment_attempts a on a.payment_id=p.id where p.order_id=$1 order by a.attempt_no desc,a.id`,
  webhooks: `select w.id::text,w.event_id as "eventId",w.event_type as event,w.provider_key as provider,w.provider_reference as reference,w.signature_verified as "signatureVerified",w.processing_status as status,w.error_code as "errorCode",w.received_at::text as "receivedAt",w.processed_at::text as "processedAt" from payment_webhook_events w where exists(select 1 from payment_attempts a join payments p on p.id=a.payment_id where p.order_id=$1 and a.provider_key=w.provider_key and a.provider_reference=w.provider_reference) order by w.received_at desc,w.id desc`,
  delivery: `select s.id,s.merchant_id as "merchantId",s.status,s.carrier,s.tracking_number as "trackingNumber",s.external_shipment_id as "providerShipmentId",s.shipped_at::text as "shippedAt",s.delivered_at::text as "deliveredAt",s.estimated_delivery_start::text as "estimatedFrom",s.estimated_delivery_end::text as "estimatedTo" from shipments s join orders o on o.id=s.order_id and o.merchant_id=s.merchant_id where o.id=$1 order by s.created_at,s.id`,
  disputes: `select d.id,d.payment_id as "paymentId",d.reason,d.status,d.created_at::text as "openedAt",d.resolution_note as resolution,d.resolved_by as "resolvedBy",d.resolved_at::text as "resolvedAt" from customer_order_disputes d join orders o on o.id=d.order_id and o.user_id=d.customer_id join payments p on p.id=d.payment_id and p.order_id=o.id where o.id=$1 order by d.created_at desc,d.id`,
  returns: `select r.id,r.order_item_id::text as "itemId",r.reason_code as category,r.reason,r.quantity,r.status,r.resolution_type as resolution,r.resolution_note as note,r.provider_refund_request_id as "refundRequestId",r.created_at::text as "requestedAt",r.received_at::text as "receivedAt",r.closed_at::text as "closedAt" from return_requests r join orders o on o.id=r.order_id and o.user_id=r.customer_id and o.merchant_id=r.merchant_id where o.id=$1 order by r.created_at desc,r.id`,
  refunds: `select r.id,r.payment_id as "paymentId",r.provider_key as provider,p.driver_key as driver,r.provider_reference as reference,r.provider_refund_id as "refundReference",r.amount::text,r.currency,r.status,r.reason,r.requested_by as "requestedBy",r.requested_at::text as "requestedAt",r.processed_at::text as "processedAt",r.updated_at::text as "updatedAt" from provider_refund_requests r join payments p on p.id=r.payment_id and p.order_id=r.order_id and p.provider_key=r.provider_key where r.order_id=$1 order by r.requested_at desc,r.id`,
  reconciliation: `select id,case_type as category,severity,status,external_reference as reference,created_at::text as "createdAt",resolved_at::text as "resolvedAt",resolved_by as "resolvedBy" from marketplace_reconciliation_cases where order_id=$1 order by created_at desc,id`,
  support: `select c.id,c.customer_id as "customerId",o.merchant_id as "merchantId",c.subject,c.category,c.status,c.assigned_to as "assignedTo",c.escalated_at::text as "escalatedAt",c.resolved_at::text as "resolvedAt",c.created_at::text as "createdAt",c.updated_at::text as "updatedAt",(select max(created_at)::text from support_messages m where m.conversation_id=c.id) as "lastMessageAt" from support_conversations c join orders o on o.id=c.order_id and o.user_id=c.customer_id where o.id=$1 order by c.updated_at desc,c.id`,
  audit: `select a.id::text,a.event_type as event,a.actor_role as actor,a.actor_user_id as "actorId",a.resource_type as resource,a.resource_id as "resourceId",a.request_id as "requestId",a.outcome,a.created_at::text as "createdAt" from audit_events a where (a.resource_type='order' and a.resource_id=$1) or a.metadata->>'orderId'=$1 or (a.resource_type='payment' and exists(select 1 from payments p where p.id=a.resource_id and p.order_id=$1)) or (a.resource_type='support_conversation' and exists(select 1 from support_conversations c where c.id=a.resource_id and c.order_id=$1)) order by a.created_at desc,a.id desc`,
  timeline: `select order_id,event_key,occurred_at::text,event_type,actor_type,actor_id,source,event_id,provider_reference,from_status,to_status from admin_order_timeline where order_id=$1 order by occurred_at,event_key`,
};
export async function orderSection(data: z.infer<typeof orderSectionInput>) {
  const sql = await getSql();
  if (!(await sql.query<{ id: string }>("select id from orders where id=$1", [data.orderId]))[0])
    throw new Error("Order unavailable");
  const rows = await sql.query<SafeRow>(`${sectionQueries[data.section]} limit $2 offset $3`, [
    data.orderId,
    data.pageSize + 1,
    data.page * data.pageSize,
  ]);
  return { rows: rows.slice(0, data.pageSize), hasMore: rows.length > data.pageSize };
}
