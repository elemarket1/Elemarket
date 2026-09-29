// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. That is what makes the auth schema safe to
 * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
 * a database that already has `0001_auth.sql` will not re-run it.
 *
 * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
 * out of scope for both until it is copied up.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/** Require an exact, uniquely ordered deployment manifest before touching the DB.
 * @param {string[]} entries @param {Record<string,string>} manifest
 */
export function validateMigrationManifest(entries, manifest) {
  const names = [...new Set(entries.filter(isMigrationFile).map(migrationName))].sort();
  const manifestNames = Object.keys(manifest).sort();
  if (!names.length) throw new Error("Deployment migrations directory is empty");
  if (names.length !== manifestNames.length || names.some((name, i) => name !== manifestNames[i])) {
    const missing = manifestNames.filter((name) => !names.includes(name));
    const untracked = names.filter((name) => !Object.prototype.hasOwnProperty.call(manifest, name));
    throw new Error(`Migration files and manifest do not match; missing=${missing.join(",") || "none"}; untracked=${untracked.join(",") || "none"}`);
  }
  const prefixes = new Set();
  for (const name of names) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match || prefixes.has(match[1])) throw new Error(`Invalid or duplicate migration number: ${name}`);
    prefixes.add(match[1]);
    if (!/^[a-f0-9]{64}$/.test(manifest[name] || "")) throw new Error(`Missing migration checksum: ${name}`);
  }
}
