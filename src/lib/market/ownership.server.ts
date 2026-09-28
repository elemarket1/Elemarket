import { getSql } from "@/lib/db";
import type { JsonObject } from "@/lib/db-types";

/**
 * Object-level authorization helpers. Every sensitive object lookup must bind
 * the authenticated principal (or an explicitly verified merchant owner) in
 * the SQL predicate; IDs supplied by the browser are identifiers, never proof
 * of ownership.
 */
export async function requireCustomerOrder(orderId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; group_id: string; user_id: string; merchant_id: string; status: string;
    currency: string; product_total: string; delivery_total: string; grand_total: string;
    address: string; created_at: string;
  }>(
    `select id, group_id, user_id, merchant_id, status, currency,
            product_total::text, delivery_total::text, grand_total::text,
            address, created_at::text
       from orders
      where id = $1 and user_id = $2
      limit 1`,
    [orderId, userId],
  );
  if (!rows[0]) throw new Error("Order not found");
  return rows[0];
}

export async function requireMerchantOrder(orderId: string, merchantId: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; group_id: string; user_id: string; merchant_id: string; status: string;
    currency: string; product_total: string; delivery_total: string; grand_total: string;
    address: string; created_at: string;
  }>(
    `select id, group_id, user_id, merchant_id, status, currency,
            product_total::text, delivery_total::text, grand_total::text,
            address, created_at::text
       from orders
      where id = $1 and merchant_id = $2
      limit 1`,
    [orderId, merchantId],
  );
  if (!rows[0]) throw new Error("Order not found");
  return rows[0];
}

export async function requireCustomerPayment(paymentId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; order_id: string; user_id: string; amount: string; currency: string;
    method: string; status: string; provider_key: string | null;
  }>(
    `select p.id, p.order_id, p.user_id, p.amount::text, p.currency,
            p.method, p.status, p.provider_key
       from payments p
       join orders o on o.id = p.order_id
      where p.id = $1 and p.user_id = $2 and o.user_id = $2
      limit 1
      for update`,
    [paymentId, userId],
  );
  if (!rows[0]) throw new Error("Payment not found");
  return rows[0];
}

export async function requireCustomerFinancingApplication(applicationId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; user_id: string; provider_id: string; order_group_id: string | null;
    amount: string; currency: string; status: string; provider_reference: string | null;
    redirect_url: string | null; expires_at: string | null; provider_decision_at: string | null; approved_amount: string | null; approved_initial_contribution: string | null; approved_currency: string | null; provider_terms: JsonObject;
  }>(
    `select id, user_id, provider_id, order_group_id, amount::text, currency,
            status, provider_reference, redirect_url, expires_at::text, provider_decision_at::text, approved_amount::text, approved_initial_contribution::text, approved_currency, provider_terms
       from customer_financing_applications
      where id = $1 and user_id = $2
      limit 1`,
    [applicationId, userId],
  );
  if (!rows[0]) throw new Error("Financing application not found");
  return rows[0];
}

export async function requireMerchantFinancingApplication(applicationId: string, merchantId: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; merchant_id: string; provider_id: string; requested_amount: string;
    currency: string; status: string; provider_reference: string | null;
    redirect_url: string | null; score_snapshot: number | null; score_model_version: string | null;
    expires_at: string | null;
  }>(
    `select id, merchant_id, provider_id, requested_amount::text, currency,
            status, provider_reference, redirect_url, score_snapshot, score_model_version,
            expires_at::text
       from merchant_financing_applications
      where id = $1 and merchant_id = $2
      limit 1`,
    [applicationId, merchantId],
  );
  if (!rows[0]) throw new Error("Financing application not found");
  return rows[0];
}
