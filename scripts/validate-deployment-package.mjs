#!/usr/bin/env node
/**
 * Validates the immutable deployment package before a production build is uploaded.
 * This is intentionally dependency-free so Render can catch migration/package drift
 * before starting the service.
 */
import { readdir, readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMigrationManifest } from "./migration-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");
const manifestPath = join(root, "migrations.sha256.json");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  const entries = await readdir(migrationsDir);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateMigrationManifest(entries, manifest);

  const migrationFiles = entries.filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
  const actual = new Set(migrationFiles);
  const manifestNames = Object.keys(manifest).sort();
  if (migrationFiles.length !== manifestNames.length || migrationFiles.some((name, i) => name !== manifestNames[i])) {
    throw new Error("Deployment migration file set does not exactly match migrations.sha256.json");
  }

  for (const name of migrationFiles) {
    const text = await readFile(join(migrationsDir, name), "utf8");
    if (sha256(text) !== manifest[name]) throw new Error(`Deployment migration checksum mismatch: ${name}`);
  }

  const authSource = join(migrationsDir, "auth", "0001_auth.sql");
  const authCopy = join(migrationsDir, "0001_auth.sql");
  await access(authSource);
  const [sourceText, copyText] = await Promise.all([readFile(authSource, "utf8"), readFile(authCopy, "utf8")]);
  if (sourceText !== copyText) throw new Error("migrations/auth/0001_auth.sql must exactly match migrations/0001_auth.sql");

  const numbers = migrationFiles.map((name) => Number(name.slice(0, 4)));
  const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (duplicates.length) throw new Error(`Duplicate migration number(s): ${[...new Set(duplicates)].join(",")}`);

  console.log(`[deployment-package] valid: ${actual.size} root migrations, manifest checksums match, auth source/copy match`);
}

main().catch((error) => {
  console.error(`[deployment-package] failed: ${error?.message || error}`);
  process.exit(1);
});
