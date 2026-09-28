import { validateRuntimeDatabaseRole } from "./runtime-db-policy.mjs";
import { paymentDriver, paymentPrefix } from "../src/lib/providers/catalog.mjs";
import { Pool } from "pg";
import { postgresConfig } from "./postgres-config.mjs";
import manifest from "../migrations.sha256.json" with { type: "json" };

const pool = new Pool({
  ...postgresConfig(process.env.DATABASE_URL),
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
  statement_timeout: 15_000,
});

async function stage(name, fn) {
  const started = Date.now();
  console.log(JSON.stringify({ event: "startup.database_validation_stage", stage: name }));
  try {
    const result = await fn();
    console.log(
      JSON.stringify({
        event: "startup.database_validation_stage_complete",
        stage: name,
        duration_ms: Date.now() - started,
      }),
    );
    return result;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "startup.database_validation_stage_failed",
        stage: name,
        duration_ms: Date.now() - started,
        error: error?.message || String(error),
        code: error?.code,
      }),
    );
    throw error;
  }
}

try {
  if (["production", "staging"].includes(process.env.ELEMARKET_ENV)) {
    await stage("runtime_database_role", () => validateRuntimeDatabaseRole(pool));
  }

  const applied = await stage("migration_integrity", () =>
    pool.query("select name,checksum from _migrations"),
  );

  if (
    Object.entries(manifest).some(
      ([name, hash]) =>
        !applied.rows.some((row) => row.name === name && row.checksum === hash),
    )
  ) {
    throw new Error("Deployment migrations are missing or mismatched");
  }

  const configured = new Set(
    (process.env.ELEMARKET_PAYMENT_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  /*
   * Payment is optional. The marketplace must boot with zero configured/active
   * payment providers. Payment-specific database validation only runs when
   * payment is actually enabled or when stale active DB configuration must be
   * detected.
   */
  const active = await stage("payment_provider_state", () =>
    pool.query(
      "select provider_key,status,driver_key,method,requires_merchant_account,supports_webhook_verification " +
        "from payment_providers where status='active'",
    ),
  );

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

    for (const provider of providers.rows) {
      const prefix = paymentPrefix(provider.provider_key);
      const driver = paymentDriver(provider.driver_key);

      if (
        !driver.capabilities.methods.includes(provider.method) ||
        provider.requires_merchant_account !== driver.capabilities.merchantAccount ||
        !provider.supports_webhook_verification
      ) {
        throw new Error(
          `payment provider '${provider.provider_key}': database method/capability mismatch`,
        );
      }

      if (
        !configured.has(provider.provider_key) ||
        process.env[`${prefix}_DRIVER`]?.trim() !== provider.driver_key ||
        driver.required.some(
          (suffix) => !process.env[`${prefix}_${suffix}`]?.trim(),
        )
      ) {
        throw new Error(
          `payment provider '${provider.provider_key}': driver/configuration mismatch`,
        );
      }
    }

    const capabilities = await stage("payment_capabilities", () =>
      pool.query(
        "select driver_key,refund from payment_driver_capabilities",
      ),
    );

    for (const provider of providers.rows) {
      if (
        !capabilities.rows.some(
          (row) => row.driver_key === provider.driver_key,
        )
      ) {
        throw new Error(
          `payment provider '${provider.provider_key}': missing database capability metadata`,
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
        activePaymentProviders: providers.rows.map(
          (provider) => provider.provider_key,
        ),
      }),
    );
  }
} finally {
  await pool.end();
}
