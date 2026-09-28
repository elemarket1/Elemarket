import { createServerFn } from "@tanstack/react-start";
import { getSessionUser } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";

export type AdminAccessState = {
  authenticated: boolean;
  isAdmin: boolean;
  displayName: string | null;
  twoFactorEnabled: boolean;
};

/**
 * Read-only admin entry-point check. This intentionally does not use the admin
 * middleware because /admin is also the unauthenticated admin sign-in page.
 * The dashboard and every sensitive admin mutation still enforce authorization
 * server-side with requireAdminForUserId().
 */
export const getAdminAccessState = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminAccessState> => {
    const user = await getSessionUser();
    if (!user) {
      return { authenticated: false, isAdmin: false, displayName: null, twoFactorEnabled: false };
    }

    const sql = await getSql();
    const rows = await sql.query<{ role: string; name: string; twoFactorEnabled: boolean }>(
      `select role, name, coalesce("twoFactorEnabled", false) as "twoFactorEnabled" from "user" where id = $1 limit 1`,
      [user.id],
    );
    const row = rows[0];
    return {
      authenticated: true,
      isAdmin: row?.role === "admin",
      displayName: row?.name ?? null,
      twoFactorEnabled: Boolean(row?.twoFactorEnabled),
    };
  },
);
