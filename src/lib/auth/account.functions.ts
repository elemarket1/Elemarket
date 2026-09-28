import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "./middleware";
import { encryptMerchantSensitiveData, sensitiveValueFingerprint } from "../security/merchant-sensitive.server";
import { enforceRateLimit } from "../security/rate-limit.server";

import { ghanaPhoneSchema as phoneSchema, normalizeGhanaPhone as normalizePhone } from "./phone";

export const getMerchantRegistrationContext = createServerFn({ method: "GET" })
  .handler(async () => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { getSessionUser } = await import("./verify.server");
    assertSameSiteRequest();

    const sessionUser = await getSessionUser();
    if (!sessionUser) return { signedIn: false as const };

    const { getSql } = await import("../db");
    const sql = await getSql();
    const rows = await sql.query<{
      name: string | null;
      phone: string | null;
      phone_verified_at: string | null;
      email: string;
      email_verified: boolean;
      role: string;
    }>(
      `select
         coalesce(p.name, u.name) as name,
         p.phone,
         p.phone_verified_at,
         u.email,
         u."emailVerified" as email_verified,
         u.role
       from "user" u
       left join profiles p on p.user_id=u.id
       where u.id=$1
       limit 1`,
      [sessionUser.id],
    );
    const row = rows[0];
    if (!row) return { signedIn: false as const };

    if (row.role === "merchant" || row.role === "admin") {
      throw new Error("This account already has merchant access");
    }

    return {
      signedIn: true as const,
      name: row.name ?? "",
      email: row.email,
      emailVerified: row.email_verified,
      phone: row.phone ?? "",
      phoneVerified: Boolean(row.phone_verified_at),
    };
  });

export const saveSignupProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(120), phone: phoneSchema }))
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await enforceRateLimit("customer-signup-profile-write", { windowSeconds: 300, maxRequests: 10, subject: userId });
    const { getSql } = await import("../db");
    const sql = await getSql();
    const phone = normalizePhone(data.phone);

    const existing = await sql.query<{ user_id: string }>(
      `select user_id from profiles where phone = $1 and user_id <> $2 limit 1`,
      [phone, userId],
    );
    if (existing[0]) throw new Error("That phone number is already registered");

    await sql.query(
      `insert into profiles (user_id, name, phone, phone_verified_at) values ($1,$2,$3,null)
       on conflict (user_id) do update set
         name=$2,
         phone=$3,
         phone_verified_at=case when profiles.phone is distinct from excluded.phone then null else profiles.phone_verified_at end,
         updated_at=now()`,
      [userId, data.name, phone],
    );

    return { phone };
  });

export const markPhoneVerified = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ challengeId: z.string().regex(/^otp_[a-f0-9]{32}$/), code: z.string().regex(/^\d{6}$/) }))
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    const { verifyOtp } = await import("./otp/otp.server");
    const result = await verifyOtp({
      challengeId: data.challengeId,
      code: data.code,
      userId,
      expectedPurpose: "phone_verification",
    });
    const { getSql } = await import("../db");
    const sql = await getSql();
    const rows = await sql.query<{ verified: boolean }>(
      `select confirm_phone_verification($1,$2) as verified`,
      [userId, data.challengeId],
    );
    if (!result.verified || rows[0]?.verified !== true) throw new Error("Phone verification was not persisted");
    return { verified: true as const };
  });


const merchantApplicationSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  address: z.string().trim().min(8).max(400),
  contact: phoneSchema,
  registrationNumber: z.string().trim().min(2).max(80),
  taxpayerIdType: z.enum(["tin", "ghana_card_pin", "other"]),
  taxpayerId: z.string().trim().min(3).max(80),
  businessType: z.enum(["sole_proprietorship", "partnership", "limited_company", "cooperative", "other"]),
  taxRegistrationStatus: z.enum(["registered", "pending", "not_registered", "not_applicable"]),
  vatRegistrationStatus: z.enum(["registered", "pending", "not_registered", "not_applicable"]).nullable().optional(),
});

export const createMerchantApplication = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(merchantApplicationSchema)
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await enforceRateLimit("merchant-application-submit", { windowSeconds: 3600, maxRequests: 3, subject: userId });
    const { getSql } = await import("../db");
    const sql = await getSql();
    const user = await sql.query<{ email_verified: boolean; role: string }>(
      `select "emailVerified" as email_verified, role from "user" where id=$1 limit 1`,
      [userId],
    );
    if (!user[0]) throw new Error("Account not found");
    if (!user[0].email_verified) throw new Error("Verify your email before applying as a merchant");
    if (user[0].role === "admin" || user[0].role === "merchant") throw new Error("This account already has merchant access");

    const existing = await sql.query<{ id: string; status: string }>(
      `select id, status from merchant_applications
        where user_id=$1 and status in ('pending','reviewing')
        order by created_at desc limit 1`,
      [userId],
    );
    if (existing[0]) return { applicationId: existing[0].id, status: existing[0].status, existing: true as const };

    const normalizedContact = normalizePhone(data.contact);
    const encryptedTaxpayerId = encryptMerchantSensitiveData({ taxpayerId: data.taxpayerId.trim() });
    const applicationId = `mapp_${crypto.randomUUID().replaceAll("-", "")}`;

    await sql.query(
      `insert into merchant_applications
        (id,user_id,business_name,category,address,contact,registration_number,
         taxpayer_id_type,taxpayer_id_encrypted,taxpayer_id_last4,business_type,tax_registration_status,vat_registration_status,compliance_updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        applicationId,
        userId,
        data.businessName,
        data.category,
        data.address,
        normalizedContact,
        data.registrationNumber.trim(),
        data.taxpayerIdType,
        encryptedTaxpayerId,
        data.taxpayerId.trim().slice(-4),
        data.businessType,
        data.taxRegistrationStatus,
        data.vatRegistrationStatus ?? null,
        new Date(),
      ],
    );

    // Carry an already-verified account email into the merchant application checks.
    // This keeps the provider-neutral verification state aligned with Better Auth.
    await sql.query(
      `update merchant_verification_checks
          set status='verified', reviewed_by=$2, reviewed_at=now(), updated_at=now()
        where application_id=$1
          and check_type='email'
          and status='pending'`,
      [applicationId, userId],
    );

    await sql.query(
      `update merchant_verification_checks mvc
          set status='verified', reviewed_by=$2, reviewed_at=now(), updated_at=now()
        from profiles p
       where mvc.application_id=$1
         and mvc.check_type='phone'
         and mvc.status='pending'
         and p.user_id=$2
         and p.phone=$3
         and p.phone_verified_at is not null`,
      [applicationId, userId, normalizedContact],
    );

    await sql.query(
      `select record_audit_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        "merchant.application.profile_submitted",
        "merchant_application",
        applicationId,
        userId,
        "customer",
        null,
        "success",
        JSON.stringify({
          taxpayerIdType: data.taxpayerIdType,
          taxpayerFingerprint: sensitiveValueFingerprint(data.taxpayerId),
          taxpayerIdLast4: data.taxpayerId.trim().slice(-4),
          businessType: data.businessType,
          taxRegistrationStatus: data.taxRegistrationStatus,
          vatRegistrationStatus: data.vatRegistrationStatus ?? null,
        }),
      ],
    );

    return { applicationId, status: "pending", existing: false as const };
  });

export const updateCustomerProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema.optional().or(z.literal("")),
    address: z.string().trim().max(400).optional(),
  }))
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await enforceRateLimit("customer-profile-write", { windowSeconds: 300, maxRequests: 10, subject: userId });
    const { getSql } = await import("../db");
    const sql = await getSql();
    const phone = data.phone ? normalizePhone(data.phone) : null;
    if (phone) {
      const existing = await sql.query<{ user_id: string }>(
        `select user_id from profiles where phone=$1 and user_id<>$2 limit 1`,
        [phone, userId],
      );
      if (existing[0]) throw new Error("That phone number is already registered");
    }
    const address = data.address?.trim() || null;
    // Customer coordinates are server-authoritative delivery data. Never accept
    // browser-supplied lat/lon. Clear the cached point whenever the customer
    // changes the address; checkout/quote flow geocodes the authoritative address.
    await sql.query(
      `insert into profiles (user_id,name,phone,address,lat,lon,phone_verified_at) values ($1,$2,$3,$4,null,null,null)
       on conflict (user_id) do update set
         name=$2,
         phone=$3,
         phone_verified_at=case when profiles.phone is distinct from excluded.phone then null else profiles.phone_verified_at end,
         address=$4,
         lat=null,
         lon=null,
         updated_at=now()`,
      [userId, data.name, phone, address],
    );
    return { saved: true as const };
  });

export const getCustomerProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const userId = getAuthenticatedUserId(context);
    const { getSql } = await import("../db");
    const sql = await getSql();
    const rows = await sql.query<{ name: string; phone: string | null; address: string | null; email: string }>(
      `select coalesce(p.name,u.name) as name,p.phone,p.address,u.email
         from "user" u left join profiles p on p.user_id=u.id where u.id=$1 limit 1`,
      [userId],
    );
    const row=rows[0];
    if (!row) throw new Error("Account not found");
    return row;
  });
