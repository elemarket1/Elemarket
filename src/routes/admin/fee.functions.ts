import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminForUserId } from "@/lib/auth/authorization.server";
import { requireFreshSession } from "@/lib/auth/verify.server";
import { recordAuditEvent } from "@/lib/security/audit.server";

export type AdminCommissionRule = {
  id: number;
  scopeType: "global" | "category" | "merchant" | "product";
  scopeId: string | null;
  ratePercent: string;
  active: boolean;
  updatedAt: string;
};

export type AdminCommissionData = {
  rules: AdminCommissionRule[];
};

export const loadCommissionPolicy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminCommissionData> => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminForUserId(adminId);
    const sql = await getSql();
    const rules = await sql.query<{
        id: number;
        scope_type: AdminCommissionRule["scopeType"];
        scope_id: string | null;
        rate_bps: number;
        active: boolean;
        updated_at: string;
      }>(
        `select id,scope_type,scope_id,rate_bps,active,updated_at::text
           from commission_rules
          order by case scope_type when 'global' then 0 when 'category' then 1 when 'merchant' then 2 else 3 end, scope_id nulls first`,
      );
    return {
      rules: rules.map((r) => ({
        id: Number(r.id),
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        ratePercent: (Number(r.rate_bps) / 100).toFixed(2),
        active: Boolean(r.active),
        updatedAt: r.updated_at,
      })),
    };
  });

const ruleSchema = z.object({
  scopeType: z.enum(["global", "category", "merchant", "product"]),
  scopeId: z.string().trim().max(200).optional().nullable(),
  ratePercent: z.number().min(0).max(100),
  active: z.boolean().default(true),
});

const globalRuleSchema = z.object({
  ratePercent: z.number().min(0).max(100),
  active: z.boolean().default(true),
});

export const setGlobalCommissionRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(globalRuleSchema)
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminForUserId(adminId);
    await requireFreshSession();
    const rateBps = Math.round(data.ratePercent * 100);
    const sql = await getSql();
    await sql.query(
      `insert into commission_rules(scope_type,scope_id,rate_bps,active,updated_by,updated_at)
       values('global',null,$1,$2,$3,now())
       on conflict (scope_type,(coalesce(scope_id,'*')))
       do update set rate_bps=excluded.rate_bps,active=excluded.active,updated_by=excluded.updated_by,updated_at=now()`,
      [rateBps, data.active, adminId],
    );
    await recordAuditEvent({
      eventType: "commission_rule_updated",
      resourceType: "commission_rule",
      resourceId: "global:global",
      actorUserId: adminId,
      actorRole: "admin",
      metadata: { scopeType: "global", scopeId: null, rateBps, active: data.active },
    });
    return { ok: true };
  });

export const setCommissionRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(ruleSchema)
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminForUserId(adminId);
    await requireFreshSession();

    const scopeId = data.scopeType === "global" ? null : data.scopeId?.trim() || null;
    if (data.scopeType !== "global" && !scopeId) throw new Error("scopeId is required for an override");

    const rateBps = Math.round(data.ratePercent * 100);
    const sql = await getSql();
    await sql.query(
      `insert into commission_rules(scope_type,scope_id,rate_bps,active,updated_by,updated_at)
       values($1,$2,$3,$4,$5,now())
       on conflict (scope_type,(coalesce(scope_id,'*')))
       do update set rate_bps=excluded.rate_bps,active=excluded.active,updated_by=excluded.updated_by,updated_at=now()`,
      [data.scopeType, scopeId, rateBps, data.active, adminId],
    );

    await recordAuditEvent({
      eventType: "commission_rule_updated",
      resourceType: "commission_rule",
      resourceId: `${data.scopeType}:${scopeId ?? "global"}`,
      actorUserId: adminId,
      actorRole: "admin",
      metadata: { scopeType: data.scopeType, scopeId, rateBps, active: data.active },
    });

    return { ok: true };
  });

const removeRuleSchema = z.object({
  scopeType: z.enum(["category", "merchant", "product"]),
  scopeId: z.string().trim().min(1).max(200),
});

export const removeCommissionOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(removeRuleSchema)
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminForUserId(adminId);
    await requireFreshSession();
    const sql = await getSql();
    await sql.query(
      `delete from commission_rules where scope_type=$1 and scope_id=$2`,
      [data.scopeType, data.scopeId],
    );
    await recordAuditEvent({
      eventType: "commission_rule_removed",
      resourceType: "commission_rule",
      resourceId: `${data.scopeType}:${data.scopeId}`,
      actorUserId: adminId,
      actorRole: "admin",
    });
    return { ok: true };
  });
