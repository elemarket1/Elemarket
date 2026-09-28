import { readFileSync } from 'node:fs';

/** @param {string} connectionString @param {NodeJS.ProcessEnv} env */
export function postgresConfig(connectionString, env = process.env) {
  const max = Number(env.PG_POOL_MAX ?? 10);
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('PG_POOL_MAX must be 1-50');
  const shared = ['production', 'staging'].includes(env.ELEMARKET_ENV ?? "");
  const runningOnRender = env.RENDER === 'true' || env.RENDER === '1';
  const sslMode = env.PG_SSL_MODE;
  const verifyFull = sslMode === 'verify-full';
  const parsedConnection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsedConnection.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const renderInternalPostgres = /^dpg-[a-z0-9][a-z0-9-]*$/i.test(parsedConnection.hostname);
  const renderRequire = renderInternalPostgres && sslMode === 'require';
  if (shared && !verifyFull && !renderRequire) {
    throw new Error(runningOnRender
      ? 'Render shared PostgreSQL requires PG_SSL_MODE=require or verify-full'
      : 'Shared PostgreSQL requires PG_SSL_MODE=verify-full');
  }
  const url = parsedConnection;
  // URL SSL options must never silently override certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(), max,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, idle_in_transaction_session_timeout: 15000,
    ssl: verifyFull
      ? { rejectUnauthorized: true, ...(env.PG_SSL_CA_FILE ? { ca: readFileSync(env.PG_SSL_CA_FILE, 'utf8') } : {}) }
      : renderRequire
        ? { rejectUnauthorized: false }
        : false,
  };
}
