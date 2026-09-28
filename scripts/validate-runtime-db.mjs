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
    console.log(JSON.stringify({
      event: "startup.database_validation_stage_complete",
      stage: name,
      duration_ms: Date.now() - started,
    }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      event: "startup.database_validation_stage_failed",
      stage: name,
      duration_ms: Date.now() - started,
      error: error?.message || String(error),
      code: error?.code,
    }));
    throw error;
  }
}

async function readAppliedMigrations() {
  const columns = await pool.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = '_migrations'
      and column_name in ('name', 'checksum')
    order by column_name
  `);

  const names = new Set(columns.rows.map((row) => row.column_name));

  if (!names.has("name")) {
    throw new Error('Database migration table "_migrations" is missing its required "name" column');
  }

  if (names.has("checksum")) {
    return {
      checksumSupported: true,
      rows: (await pool.query("select name, checksum from _migrations")).rows,
    };
  }

  console.warn(JSON.stringify({
    event: "startup.migration_checksum_warning",
    message:
      'Database "_migrations" table has no checksum column. Verifying migration names only; the deploy migrator will add/populate checksum on its next run.',
  }));

  return {
    checksumSupported: false,
    rows: (await pool.query("select name from _migrations")).rows,
  };
}

try {
  if (["production", "staging"].includes(process.env.ELEMARKET_ENV)) {
    await stage("runtime_database_role", () => validateRuntimeDatabaseRole(pool));
  }

  const applied = await stage("migration_integrity", readAppliedMigrations);

  const appliedByName = new Map(applied.rows.map((row) => [row.name, row]));
  const missing = Object.keys(manifest).filter((name) => !appliedByName.has(name));

  if (missing.length) {
    throw new Error(
      `Deployment migrations are missing or mismatched: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`,
    );
  }

  if (applied.checksumSupported) {
    for (const [name, row] of appliedByName) {
      const expected = manifest[name];
      if (!expected) {
        throw new Error(`Applied migration is absent from manifest: ${name}`);
      }
      if (row.checksum && row.checksum !== expected) {
        throw new Error(`Applied migration checksum drift detected: ${name}`);
      }
    }
  }

  const configured = new Set(
    (process.env.ELEMARKET_PAYMENT_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const active = await stage("payment_provider_state", () =>
    pool.query(
      "select provider_key,status,driver_key,method,requires_merchant_account,supports_webhook_verification " +
        "from payment_providers where status='active'",
    ),
  );

  if (!active.rows.length && !configured.size) {
    console.log(JSON.stringify({
      event: "startup.database_validated",
      payment: "disabled",
    }));
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

    console.log(JSON.stringify({
      event: "startup.database_validated",
      payment: "enabled",
      activePaymentProviders: providers.rows.map((provider) => provider.provider_key),
    }));
  }
} finally {
  await pool.end();
}
