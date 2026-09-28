import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { JsonValue } from "@/lib/db-types";
import { getSql } from "@/lib/db";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminForUserId } from "@/lib/auth/authorization.server";
import { requireFreshSession } from "@/lib/auth/verify.server";

export type AdminModerationData = {
  merchants: Array<{ id:string; name:string; status:string; tier:string; settlementModel:string; catalogSource:string; ownerId:string|null; ownerEmail:string|null }>;
  customers: Array<{ id:string; name:string; email:string; status:string; createdAt:string }>;
  products: Array<{ id:string; name:string; merchantId:string; merchantName:string; status:string; price:string; createdAt:string }>;
};

export const loadAdminModeration = createServerFn({ method:"GET" }).middleware([authMiddleware]).handler(async ({context}):Promise<AdminModerationData> => {
  const adminId=getAuthenticatedUserId(context); await requireAdminForUserId(adminId); const sql=await getSql();
  const [merchants,customers,products]=await Promise.all([
    sql.query<any>(`select m.id,m.name,m.status,m.tier,m.settlement_model,m.catalog_source,ma.user_id as owner_id,u.email as owner_email from merchants m left join merchant_accounts ma on ma.merchant_id=m.id left join "user" u on u.id=ma.user_id order by m.created_at desc limit 100`),
    sql.query<any>(`select id,name,email,"moderationStatus" as status,"createdAt" from "user" where role='customer' order by "createdAt" desc limit 100`),
    sql.query<any>(`select p.id,p.name,p.merchant_id,p.status,p.price::text,p.created_at,m.name as merchant_name from products p join merchants m on m.id=p.merchant_id where p.status='pending_review' order by p.created_at asc limit 100`),
  ]);
  return { merchants:merchants.map((r:any)=>({id:r.id,name:r.name,status:r.status,tier:r.tier,settlementModel:r.settlement_model,catalogSource:r.catalog_source,ownerId:r.owner_id??null,ownerEmail:r.owner_email??null})), customers:customers.map((r:any)=>({id:r.id,name:r.name,email:r.email,status:r.status,createdAt:r.createdAt})), products:products.map((r:any)=>({id:r.id,name:r.name,merchantId:r.merchant_id,merchantName:r.merchant_name,status:r.status,price:r.price,createdAt:r.created_at})) };
});

const merchantAction=z.object({merchantId:z.string().min(1).max(128),action:z.enum(["suspend","reinstate"]),reason:z.string().max(2000).optional()});
export const moderateMerchant=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(merchantAction).handler(async({data,context})=>{const adminId=getAuthenticatedUserId(context);await requireAdminForUserId(adminId);await requireFreshSession();const sql=await getSql();const rows=await sql.query<{result:JsonValue}>(`select admin_set_merchant_status($1,$2,$3,$4) result`,[data.merchantId,adminId,data.action==='reinstate'?'active':'suspended',data.reason?.trim() ?? ""]);return rows[0]?.result??null;});

const customerAction=z.object({userId:z.string().min(1).max(128),action:z.enum(["blacklist","unblacklist"]),reason:z.string().min(3).max(2000)});
export const moderateCustomer=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(customerAction).handler(async({data,context})=>{const adminId=getAuthenticatedUserId(context);await requireAdminForUserId(adminId);await requireFreshSession();const sql=await getSql();const rows=await sql.query<{result:JsonValue}>(`select admin_set_customer_blacklist($1,$2,$3,$4) result`,[data.userId,adminId,data.action==='blacklist',data.reason.trim()]);return rows[0]?.result??null;});


const productAction=z.object({productId:z.string().min(1).max(128),action:z.enum(["approve","suspend","archive"]),reason:z.string().min(3).max(2000)});
export const moderateProduct=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(productAction).handler(async({data,context})=>{const adminId=getAuthenticatedUserId(context);await requireAdminForUserId(adminId);await requireFreshSession();const sql=await getSql();const status=data.action==='approve'?'active':data.action==='archive'?'archived':'suspended';const rows=await sql.query<{result:JsonValue}>(`select admin_set_product_status($1,$2,$3,$4) result`,[data.productId,adminId,status,data.reason.trim()]);return rows[0]?.result??null;});

const enterpriseAction=z.object({merchantId:z.string().min(1).max(128),action:z.enum(["enable","disable"]),reason:z.string().min(3).max(2000)});
export const setMerchantEnterpriseMode=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(enterpriseAction).handler(async({data,context})=>{
  const adminId=getAuthenticatedUserId(context); await requireAdminForUserId(adminId); await requireFreshSession(); const sql=await getSql();
  const rows=await sql.query<{result:JsonValue}>(`select admin_set_merchant_enterprise_mode($1,$2,$3,$4) result`,[data.merchantId,adminId,data.action==='enable',data.reason.trim()]);
  return rows[0]?.result??null;
});
