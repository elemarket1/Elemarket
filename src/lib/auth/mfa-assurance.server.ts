import { getSql } from "../db";

/** Only called after Better Auth successfully verifies a TOTP, never after password/trust sign-in. */
export async function recordTotpAssurance(path: string, returned: unknown, trustDevice: unknown, verifiedSessionToken?: string): Promise<void> {
  if (path !== "/two-factor/verify-totp" || trustDevice === true) return;
  if (!returned || typeof returned !== "object" || !("token" in returned) || typeof returned.token !== "string") return;
  const sql = await getSql();
  await sql.query(`insert into admin_session_assurance(session_id,user_id,method,verified_at)
    select s.id,s."userId",'totp',now() from session s join "user" u on u.id=s."userId"
    where s.token=$1 and s."expiresAt">now() and u."twoFactorEnabled"=true
    on conflict(session_id) do update set verified_at=excluded.verified_at`, [verifiedSessionToken ?? returned.token]);
}
