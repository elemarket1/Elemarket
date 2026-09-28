import { requireUserId } from "./verify.server";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./server";

export type AppRole = "customer" | "merchant" | "admin";

/**
 * Server-only authorization helpers.
 *
 * Authentication answers "who is this?"; authorization answers "what may they
 * do?". Never accept a role or ownership decision from request JSON, query
 * parameters, localStorage, or client state.
 */
async function loadRole(userId: string): Promise<AppRole> {
  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql.query<{ role: AppRole }>(
    `select role from "user" where id = $1 limit 1`,
    [userId],
  );
  const role = rows[0]?.role;
  if (role === "customer") {
    const moderation = await sql.query<{ moderationStatus: string }>(
      `select "moderationStatus" from "user" where id = $1 limit 1`,
      [userId],
    );
    if (moderation[0]?.moderationStatus === "blacklisted") throw new Error("Account is blacklisted");
  }
  if (role !== "customer" && role !== "merchant" && role !== "admin") {
    throw new Error("Forbidden");
  }
  return role;
}

export async function requireRoleForUserId(
  allowed: readonly AppRole[],
  userId: string,
): Promise<{ userId: string; role: AppRole }> {
  const role = await loadRole(userId);
  if (!allowed.includes(role)) throw new Error("Forbidden");
  if (role === "admin") await assertAdminSessionAssurance(userId);
  return { userId, role };
}

export async function getCurrentRole(bearerToken?: string): Promise<AppRole> {
  return loadRole(await requireUserId(bearerToken));
}

export async function requireRole(
  allowed: readonly AppRole[],
  bearerToken?: string,
): Promise<{ userId: string; role: AppRole }> {
  return requireRoleForUserId(allowed, await requireUserId(bearerToken));
}

export async function requireCustomer(bearerToken?: string) {
  return requireRole(["customer"], bearerToken);
}

export async function requireCustomerForUserId(userId: string) {
  return requireRoleForUserId(["customer"], userId);
}

export async function requireCustomerOrAdmin(bearerToken?: string) {
  return requireRole(["customer", "admin"], bearerToken);
}

export async function requireCustomerOrAdminForUserId(userId: string) {
  return requireRoleForUserId(["customer", "admin"], userId);
}

export async function requireAdmin(bearerToken?: string) {
  return requireRole(["admin"], bearerToken);
}

export async function requireAdminRoleForUserId(userId: string) {
  return requireRoleForUserId(["admin"], userId);
}

export async function requireAdminForUserId(userId: string) {
  return requireRoleForUserId(["admin"], userId);
}

async function assertAdminSessionAssurance(userId: string): Promise<void> {
  const request = getRequest();
  if (!request) throw new Error("Administrator authentication assurance is required");

  // Use Better Auth's canonical request-session resolution instead of parsing
  // the session cookie ourselves. This keeps the authorization check aligned
  // with the same cookie/session semantics used by getSessionUser(), including
  // cookie prefixes, secure-cookie handling, and any future Better Auth changes.
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.id !== userId || !session.session) {
    throw new Error("Administrator authentication assurance is required");
  }

  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql.query<{ enabled: boolean; enabled_at: string | null }>(
    `select coalesce("twoFactorEnabled", false) as enabled, "twoFactorEnabledAt" as enabled_at
       from "user" where id=$1 limit 1`,
    [userId],
  );
  if (!rows[0]?.enabled) throw new Error("Administrator two-factor authentication is required");

  const assurance = await sql.query<{ verified_at: string }>(
    `select a.verified_at from admin_session_assurance a join session s on s.id=a.session_id
      where a.session_id=$1 and a.user_id=$2 and s."userId"=$2 and s."expiresAt">now()
        and a.method='totp' and a.verified_at >= coalesce((select "twoFactorEnabledAt" from "user" where id=$2),'-infinity'::timestamptz)`,
    [session.session.id, userId],
  );
  if (!assurance[0]) throw new Error("Administrator session requires verified TOTP two-factor authentication");

  const createdAt = Date.parse(String(session.session.createdAt));
  const enabledAt = rows[0].enabled_at ? Date.parse(rows[0].enabled_at) : NaN;
  if (!Number.isFinite(createdAt) || (Number.isFinite(enabledAt) && createdAt < enabledAt)) {
    throw new Error("Administrator session predates required two-factor authentication");
  }
}

export async function requireMerchantOrAdmin(bearerToken?: string) {
  return requireRole(["merchant", "admin"], bearerToken);
}

/**
 * Merchant workspace authorization. A user may remain a customer at the base
 * identity level while gaining merchant access through an active merchant
 * membership. Admins are always permitted to enter the merchant context.
 */
export async function requireMerchantOrAdminForUserId(userId: string): Promise<{ userId: string; role: AppRole }> {
  const principal = await requireRoleForUserId(["customer", "merchant", "admin"], userId);
  if (principal.role === "admin" || principal.role === "merchant") return principal;

  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql.query<{ merchant_id: string }>(
    `select merchant_id
       from merchant_accounts
      where user_id=$1 and status='active'
      limit 1`,
    [userId],
  );
  if (!rows[0]) throw new Error("Merchant access denied");
  return { userId, role: "merchant" };
}

/**
 * Proves that the authenticated principal may operate on this merchant.
 * Admins may operate across merchants; merchants may operate only on accounts
 * explicitly linked to their verified session identity.
 */
export async function requireMerchantWorkspaceForUserId(
  userId: string,
): Promise<{ userId: string; role: AppRole; merchantIds: string[] }> {
  const principal = await requireRoleForUserId(["customer", "merchant", "admin"], userId);
  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql.query<{ merchant_id: string }>(
    `select merchant_id
       from merchant_accounts
      where user_id = $1 and status = 'active'
      order by created_at asc`,
    [userId],
  );
  if (rows.length === 0) throw new Error("Merchant access denied");
  return { ...principal, merchantIds: rows.map((row) => row.merchant_id) };
}

export async function requireMerchantAccessForUserId(
  merchantId: string,
  userId: string,
): Promise<{ userId: string; role: AppRole }> {
  const principal = await requireRoleForUserId(["customer", "merchant", "admin"], userId);
  if (principal.role === "admin") return principal;

  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql.query<{ merchant_id: string }>(
    `select merchant_id
       from merchant_accounts
      where merchant_id = $1
        and user_id = $2
        and status = 'active'
      limit 1`,
    [merchantId, principal.userId],
  );
  if (!rows[0]) throw new Error("Merchant access denied");
  return principal;
}

export async function requireMerchantAccess(
  merchantId: string,
  bearerToken?: string,
): Promise<{ userId: string; role: AppRole }> {
  return requireMerchantAccessForUserId(merchantId, await requireUserId(bearerToken));
}
