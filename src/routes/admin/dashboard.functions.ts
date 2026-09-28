import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminForUserId } from "@/lib/auth/authorization.server";
import { requireFreshSession } from "@/lib/auth/verify.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/permissions.server";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AdminMerchantReview = {
  id: string;
  businessName: string;
  category: string;
  contact: string;
  status: string;
  createdAt: string;
  businessNumber: string;
  taxpayerIdMasked: string | null;
  taxRegistrationStatus: string | null;
  vatRegistrationStatus: string | null;
  verification: {
    email: string;
    phone: string;
    identity: string;
    business: string;
    document: string;
    payout: string;
  };
};

export type AdminDashboardData = {
  metrics: {
    merchantReviews: number;
    pendingPayments: number;
    rejectedWebhooks24h: number;
    errors24h: number;
    activeMerchants: number;
    refundExceptions: number;
    ordersToday: number;
  };
  merchantReviews: AdminMerchantReview[];
  paymentExceptions: Array<{
    id: string;
    status: string;
    providerKey: string;
    amount: string;
    createdAt: string;
    failureCode: string | null;
  }>;
  disputes: Array<{ id: string; orderId: string; reason: string; status: string; amount: string }>;
  refundRequests: Array<{
    id: string;
    orderId: string;
    paymentId: string;
    status: string;
    amount: string;
    reason: string | null;
    providerRefundId: string | null;
    createdAt: string;
  }>;
  riskFlags: Array<{
    id: string; subjectType: string; subjectId: string; flagCode: string; severity: string;
    status: string; evidence: JsonValue; createdAt: string;
  }>;
  auditEvents: Array<{
    id: number;
    eventType: string;
    resourceType: string;
    resourceId: string | null;
    outcome: string;
    actorRole: string | null;
    createdAt: string;
  }>;
};

export const loadAdminDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminDashboardData> => {
    const userId = getAuthenticatedUserId(context);
    await requireAdminForUserId(userId);
    const sql = await getSql();

    const disputes = await sql.query<AdminDashboardData["disputes"][number]>(
      `select d.id,d.order_id as "orderId",d.reason,d.status,p.amount::text
        from customer_order_disputes d join payments p on p.id=d.payment_id and p.order_id=d.order_id
        where d.status in ('open','under_review') order by d.created_at limit 50`,
    );
    const merchantReviews = await sql.query<{ n: number }>(
        `select count(*)::int as n from merchant_applications where status in ('pending','reviewing')`,
      );
    const pendingPayments = await sql.query<{ n: number }>(
        `select count(*)::int as n from payment_attempts where status in ('initiated','pending','authorized')`,
      );
    const rejectedWebhooks24h = await sql.query<{ n: number }>(
        `select count(*)::int as n from payment_webhook_rejections where rejected_at>now()-interval '24 hours'`,
      );
    const errors24h = await sql.query<{ n: number }>(
        `select count(*)::int as n from observability_events where severity='error' and created_at>now()-interval '24 hours'`,
      );
    const activeMerchants = await sql.query<{ n: number }>(
        `select count(*)::int as n from merchants where status='active'`,
      );
    const refundExceptions = await sql.query<{ n: number }>(
        `select ((select count(*) from provider_refund_requests where status in ('needs_attention','failed')) + (select count(*) from marketplace_reconciliation_cases where case_type='payment' and status in ('open','investigating')))::int as n`,
      );
    const ordersToday = await sql.query<{ n: number }>(
        `select count(*)::int as n from orders where created_at >= current_date`,
      );
    const merchantRows = await sql.query<{
        id: string;
        business_name: string;
        category: string;
        contact: string;
        registration_number: string;
        taxpayer_id_last4: string | null;
        tax_registration_status: string | null;
        vat_registration_status: string | null;
        status: string;
        created_at: string;
        email_status: string;
        phone_status: string;
        identity_status: string;
        business_status: string;
        document_status: string;
        payout_status: string;
      }>(
        `select
           a.id,
           a.business_name,
           a.category,
           a.contact,
           a.registration_number,
           a.taxpayer_id_last4,
           a.tax_registration_status,
           a.vat_registration_status,
           a.status,
           to_char(a.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as created_at,
           coalesce(v.email_status,'pending') as email_status,
           coalesce(v.phone_status,'pending') as phone_status,
           coalesce(v.identity_status,'not_started') as identity_status,
           coalesce(v.business_status,'not_started') as business_status,
           coalesce(v.document_status,'not_started') as document_status,
           coalesce(v.payout_status,'not_started') as payout_status
         from merchant_applications a
         left join lateral (
           select
             max(status) filter (where check_type='email') as email_status,
             max(status) filter (where check_type='phone') as phone_status,
             max(status) filter (where check_type='identity') as identity_status,
             max(status) filter (where check_type='business') as business_status,
             max(status) filter (where check_type='document') as document_status,
             max(status) filter (where check_type='payout') as payout_status
           from merchant_verification_checks
           where application_id=a.id
         ) v on true
         where a.status in ('pending','reviewing')
         order by a.created_at asc
         limit 50`,
      );
    const paymentRows = await sql.query<{
        id: string;
        status: string;
        provider_key: string;
        amount: string;
        created_at: string;
        failure_code: string | null;
      }>(
        `select
           pa.id,
           pa.status,
           pa.provider_key,
           pa.amount::text as amount,
           to_char(pa.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as created_at,
           pa.failure_code
         from payment_attempts pa
         where pa.status in ('initiated','pending','authorized','failed')
         order by pa.updated_at desc
         limit 30`,
      );
    const refundRows = await sql.query<{
        id: string;
        order_id: string;
        payment_id: string;
        status: string;
        amount: string;
        reason: string | null;
        provider_refund_id: string | null;
        created_at: string;
      }>(
        `select id, order_id, payment_id, status, amount::text as amount, reason,
                provider_refund_id,
                to_char(requested_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as created_at
         from provider_refund_requests
         where status in ('requested','processing','needs_attention','failed')
         order by requested_at asc
         limit 30`,
      );
    const riskFlagRows = await sql.query<{
        id: string; subject_type: string; subject_id: string; flag_code: string; severity: string;
        status: string; evidence: JsonValue; created_at: string;
      }>(`
        select id,subject_type,subject_id,flag_code,severity,status,evidence,
               to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as created_at
          from risk_flags
         where status='open'
         order by created_at desc limit 50
      `);
    const auditRows = await sql.query<{
        id: number;
        event_type: string;
        resource_type: string;
        resource_id: string | null;
        outcome: string;
        actor_role: string | null;
        created_at: string;
      }>(
        `select id, event_type, resource_type, resource_id, outcome, actor_role,
                to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as created_at
         from audit_events
         order by created_at desc
         limit 40`,
      );

    return {
      disputes,
      metrics: {
        merchantReviews: merchantReviews[0]?.n ?? 0,
        pendingPayments: pendingPayments[0]?.n ?? 0,
        rejectedWebhooks24h: rejectedWebhooks24h[0]?.n ?? 0,
        errors24h: errors24h[0]?.n ?? 0,
        activeMerchants: activeMerchants[0]?.n ?? 0,
        refundExceptions: refundExceptions[0]?.n ?? 0,
        ordersToday: ordersToday[0]?.n ?? 0,
      },
      merchantReviews: merchantRows.map((row) => ({
        id: row.id,
        businessName: row.business_name,
        category: row.category,
        contact: row.contact,
        businessNumber: row.registration_number,
        taxpayerIdMasked: row.taxpayer_id_last4 ? `••••${row.taxpayer_id_last4}` : null,
        taxRegistrationStatus: row.tax_registration_status,
        vatRegistrationStatus: row.vat_registration_status,
        status: row.status,
        createdAt: row.created_at,
        verification: {
          email: row.email_status,
          phone: row.phone_status,
          identity: row.identity_status,
          business: row.business_status,
          document: row.document_status,
          payout: row.payout_status,
        },
      })),
      paymentExceptions: paymentRows.map((row) => ({
        id: row.id,
        status: row.status,
        providerKey: row.provider_key,
        amount: row.amount,
        createdAt: row.created_at,
        failureCode: row.failure_code,
      })),
      refundRequests: refundRows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        paymentId: row.payment_id,
        status: row.status,
        amount: row.amount,
        reason: row.reason,
        providerRefundId: row.provider_refund_id,
        createdAt: row.created_at,
      })),
      riskFlags: riskFlagRows.map((row) => ({
        id: row.id, subjectType: row.subject_type, subjectId: row.subject_id, flagCode: row.flag_code, severity: row.severity,
        status: row.status, evidence: row.evidence, createdAt: row.created_at,
      })),
      auditEvents: auditRows.map((row) => ({
        id: Number(row.id),
        eventType: row.event_type,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        outcome: row.outcome,
        actorRole: row.actor_role,
        createdAt: row.created_at,
      })),
    };
  });


const sensitiveRevealSchema = z.object({ applicationId: z.string().min(1).max(128) });

export const viewMerchantSensitiveData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(sensitiveRevealSchema)
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminForUserId(adminId);
    await requireFreshSession();
    const sql = await getSql();
    const rows = await sql.query<{
      registration_number: string;
      taxpayer_id_type: string;
      taxpayer_id_encrypted: string;
      business_type: string;
      tax_registration_status: string;
      vat_registration_status: string | null;
    }>(`select registration_number,taxpayer_id_type,taxpayer_id_encrypted,business_type,
              tax_registration_status,vat_registration_status
         from merchant_applications where id=$1 limit 1`, [data.applicationId]);
    const row = rows[0];
    if (!row) throw new Error("Merchant application not found");
    const { decryptMerchantSensitiveData } = await import("@/lib/security/merchant-sensitive.server");
    const taxpayerId = decryptMerchantSensitiveData<string>(row.taxpayer_id_encrypted);
    await sql.query(`select record_audit_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [
      "admin.merchant.sensitive_data.viewed", "merchant_application", data.applicationId, adminId, "admin", null, "success",
      JSON.stringify({ fields: ["taxpayerId"], taxpayerIdType: row.taxpayer_id_type }),
    ]);
    return {
      businessNumber: row.registration_number,
      taxpayerIdType: row.taxpayer_id_type,
      taxpayerId,
      businessType: row.business_type,
      taxRegistrationStatus: row.tax_registration_status,
      vatRegistrationStatus: row.vat_registration_status,
    };
  });


const providerRefundSchema = z.object({
  orderId: z.string().min(1).max(128),
  note: z.string().max(2000).optional(),
}).strict();

export const requestAdminProviderRefund = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(providerRefundSchema)
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await requireAdminCapability("initiate_refund", userId, true);
    await requireFreshSession();
    await enforceRateLimit("admin-provider-refund", { windowSeconds: 300, maxRequests: 10, subject: userId });
    const sql = await getSql();
    const rows = await sql.query<{ payment_id: string | null }>(
      `select p.id as payment_id from payments p
         join orders o on o.id=p.order_id and o.user_id=p.user_id
        where o.id=$1 and p.status='completed'
        order by p.created_at desc limit 1 for update of p`,
      [data.orderId],
    );
    const paymentId = rows[0]?.payment_id;
    if (!paymentId) throw new Error("Order has no completed payment");
    const disputes = await sql.query<{ id: string }>(
      `select id from customer_order_disputes where order_id=$1 and payment_id=$2 and status in ('open','under_review') order by created_at desc limit 1`,
      [data.orderId, paymentId],
    );
    if (disputes[0]) await requireAdminCapability("manage_dispute", userId, true);
    const prepared = await sql.query<{ result: unknown }>(
      disputes[0] ? `select prepare_provider_refund_for_dispute($1,$2,$3) as result` : `select prepare_provider_refund_for_payment($1,$2,$3) as result`,
      [disputes[0]?.id ?? paymentId, userId, data.note ?? "admin_refund_request"],
    );
    const result = prepared[0]?.result as { requestId?: string } | null;
    if (!result?.requestId) throw new Error("Provider refund request could not be prepared");
    const { executeProviderRefundAsAdmin } = await import("@/lib/market/refunds.server");
    await sql.query("select record_audit_event('admin.refund.requested','order',$1,$2,'admin',null,'success',jsonb_build_object('refundRequestId',$3::text))", [data.orderId,userId,result.requestId]);
    return await executeProviderRefundAsAdmin(String(result.requestId));
  });

