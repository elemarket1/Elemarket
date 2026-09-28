import { validateRuntimeDatabaseRole } from "./runtime-db-policy.mjs";
import { paymentDriver, paymentPrefix } from "../src/lib/providers/catalog.mjs";
import { Pool } from "pg";
import { postgresConfig } from "./postgres-config.mjs";
import manifest from "../migrations.sha256.json" with { type: "json" };

const pool = new Pool(postgresConfig(process.env.DATABASE_URL));

try {
  if (["production", "staging"].includes(process.env.ELEMARKET_ENV)) {
    await validateRuntimeDatabaseRole(pool);
  }

  const applied = await pool.query("select name,checksum from _migrations");
  if (
    Object.entries(manifest).some(
      ([name, hash]) => !applied.rows.some((r) => r.name === name && r.checksum === hash),
    )
  ) {
    throw new Error("Deployment migrations are missing or mismatched");
  }

  /*
   * Payment is an optional adapter capability.
   *
   * The marketplace must be able to boot with zero payment providers.
   * When payment is explicitly enabled, however, every active provider must
   * still have a reviewed driver, matching environment configuration, and
   * matching database capability metadata.
   */
  const configured = new Set(
    (process.env.ELEMARKET_PAYMENT_PROVIDERS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

  const active = await pool.query(
    "select provider_key,status,driver_key,method,requires_merchant_account,supports_webhook_verification " +
      "from payment_providers where status='active'",
  );

  // No active providers + no explicit payment configuration is a valid
  // provider-neutral marketplace deployment. Do not force Paystack, Hubtel,
  // or any other payment vendor merely to start the application.
  if (!active.rows.length && !configured.size) {
    console.log(
      JSON.stringify({
        event: "startup.database_validated",
        payment: "disabled",
      }),
    );
  } else {
    if (active.rows.length && !configured.size) {
      throw new Error(
        "Active payment providers exist in the database but ELEMARKET_PAYMENT_PROVIDERS is not configured",
      );
    }

    const providers = active;

    for (const p of providers.rows) {
    const prefix = paymentPrefix(p.provider_key);
    const driver = paymentDriver(p.driver_key);

    if (
      !driver.capabilities.methods.includes(p.method) ||
      p.requires_merchant_account !== driver.capabilities.merchantAccount ||
      !p.supports_webhook_verification
    ) {
      throw new Error(
        `payment provider '${p.provider_key}': database method/capability mismatch`,
      );
    }

    if (
      !configured.has(p.provider_key) ||
      process.env[`${prefix}_DRIVER`]?.trim() !== p.driver_key ||
      driver.required.some(
        (suffix) => !process.env[`${prefix}_${suffix}`]?.trim(),
      )
    ) {
      throw new Error(
        `payment provider '${p.provider_key}': driver/configuration mismatch`,
      );
    }
  }

  const capabilities = await pool.query(
    "select driver_key,refund from payment_driver_capabilities",
  );

  for (const p of providers.rows) {
    if (
      !capabilities.rows.some((row) => row.driver_key === p.driver_key)
    ) {
      throw new Error(
        `payment provider '${p.provider_key}': missing database capability metadata`,
      );
    }
  }

  for (const row of capabilities.rows) {
    const driver = paymentDriver(row.driver_key);
    if (row.refund !== driver.capabilities.refund) {
      throw new Error("Database payment capability mismatch");
    }
  }

    console.log(
      JSON.stringify({
        event: "startup.database_validated",
        payment: "enabled",
        activePaymentProviders: providers.rows.map((p) => p.provider_key),
      }),
    );
  }
} finally {
  await pool.end();
}
