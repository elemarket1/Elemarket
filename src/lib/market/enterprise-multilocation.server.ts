import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { requireMerchantAccessForUserId, requireMerchantWorkspaceForUserId } from "@/lib/auth/authorization.server";

export type EnterpriseLocationRow = { id:string; name:string; location_type:string; status:string; city:string; country_code:string|null; address:string; latitude:number|null; longitude:number|null; timezone:string; cutoff_time:string|null; external_location_key:string|null; available_units:number; reserved_units:number };

export async function requireEnterpriseAdmin(merchantId: string, userId: string) {
  await requireMerchantWorkspaceForUserId(userId);
  await requireMerchantAccessForUserId(merchantId, userId);
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `select id from enterprise_organizations where merchant_id=$1 and status='active'`, [merchantId],
  );
  if (!rows[0]) throw new Error("Enterprise organization is not active");
  await sql.query(`select assert_enterprise_admin_access($1,$2)`, [userId, rows[0].id]);
  return rows[0].id;
}

export async function listEnterpriseLocations(merchantId: string, userId: string) {
  const organizationId = await requireEnterpriseAdmin(merchantId, userId);
  const sql = await getSql();
  const rows = await sql.query<EnterpriseLocationRow>(
    `select l.id,l.name,l.location_type,l.status,l.city,l.country_code,l.address,l.latitude,l.longitude,l.timezone,l.cutoff_time,l.external_location_key,
            coalesce(sum(i.available),0)::int as available_units,
            coalesce(sum(i.reserved),0)::int as reserved_units
       from merchant_inventory_locations l
       left join product_location_inventory i on i.location_id=l.id
      where l.organization_id=$1
      group by l.id
      order by l.name`, [organizationId],
  );
  return rows;
}

export async function createEnterpriseLocation(input: { merchantId: string; userId: string; name: string; address: string; city: string; countryCode?: string; locationType: string; externalLocationKey?: string; latitude?: number; longitude?: number; timezone?: string }) {
  const organizationId = await requireEnterpriseAdmin(input.merchantId, input.userId);
  const sql = await getSql();
  const id = `loc_${randomUUID().replaceAll("-", "")}`;
  await sql.query(`insert into merchant_inventory_locations(id,merchant_id,organization_id,name,address,city,country_code,location_type,external_location_key,latitude,longitude,timezone) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id,input.merchantId,organizationId,input.name.trim(),input.address.trim(),input.city.trim(),(input.countryCode??"GH").toUpperCase(),input.locationType,input.externalLocationKey??id,input.latitude??null,input.longitude??null,input.timezone??"Africa/Accra"]);
  return { id };
}

export async function transferEnterpriseInventory(input: { merchantId: string; userId: string; productId: string; fromLocationId: string; toLocationId: string; quantity: number; idempotencyKey: string }) {
  const organizationId = await requireEnterpriseAdmin(input.merchantId, input.userId);
  const sql = await getSql();
  if (input.quantity < 1) throw new Error("Invalid quantity");
  await sql.query(`select assert_enterprise_location_access($1,$2,null)`, [input.userId,input.fromLocationId]);
  await sql.query(`select assert_enterprise_location_access($1,$2,null)`, [input.userId,input.toLocationId]);
  const id = `tr_${randomUUID().replaceAll("-", "")}`;
  await sql.query(`insert into enterprise_inventory_transfers(id,organization_id,product_id,from_location_id,to_location_id,quantity,status,idempotency_key,requested_by) values($1,$2,$3,$4,$5,$6,'requested',$7,$8) on conflict(idempotency_key) do nothing`, [id,organizationId,input.productId,input.fromLocationId,input.toLocationId,input.quantity,input.idempotencyKey,input.userId]);
  return { id };
}

export async function receiveEnterpriseInventoryTransfer(input: { merchantId: string; transferId: string; userId: string }) {
  const organizationId = await requireEnterpriseAdmin(input.merchantId, input.userId);
  const sql = await getSql();
  await sql.query(`select receive_enterprise_inventory_transfer($1,$2,$3)`, [organizationId, input.transferId, input.userId]);
  return { status: "received" as const };
}

export async function listEnterpriseIntegrations(merchantId: string, userId: string) {
  const organizationId = await requireEnterpriseAdmin(merchantId, userId);
  const sql = await getSql();
  return sql.query(`select id,integration_type,provider_key,display_name,status,location_id,last_success_at,last_failure_at,created_at,updated_at from enterprise_integrations where organization_id=$1 order by display_name`, [organizationId]);
}

export async function createEnterpriseServiceCase(input: {
  merchantId: string;
  userId: string;
  customerUserId: string;
  orderId?: string;
  orderItemId?: number;
  productId?: string;
  serialUnitId?: string;
  serviceLocationId?: string;
  caseType: "warranty" | "repair" | "replacement" | "installation" | "inspection" | "recall";
  priority?: "low" | "normal" | "high" | "urgent";
  issueSummary: string;
}) {
  const organizationId = await requireEnterpriseAdmin(input.merchantId, input.userId);
  const sql = await getSql();
  const id = `svc_${randomUUID().replaceAll("-", "")}`;
  await sql.query(
    `insert into enterprise_service_cases(id,organization_id,customer_user_id,order_id,order_item_id,product_id,serial_unit_id,service_location_id,case_type,priority,issue_summary)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, organizationId, input.customerUserId, input.orderId ?? null, input.orderItemId ?? null, input.productId ?? null, input.serialUnitId ?? null, input.serviceLocationId ?? null, input.caseType, input.priority ?? "normal", input.issueSummary.trim()],
  );
  await sql.query(`select record_audit_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [
    "enterprise.service_case.created", "enterprise_service_case", id, input.userId, "merchant", null, "success",
    JSON.stringify({ organizationId, caseType: input.caseType, priority: input.priority ?? "normal" }),
  ]);
  return { id };
}
