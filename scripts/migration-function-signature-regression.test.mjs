import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

function splitParams(raw) {
  const out = []; let cur = ""; let depth = 0;
  for (const ch of raw) {
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function signature(raw) {
  const params = splitParams(raw);
  return {
    types: params.map((p) => {
      const first = p.match(/^(?:inout\s+|in\s+|out\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+/i);
      const rest = first ? p.slice(first[0].length) : p;
      return rest.split(/\s+default\s+/i)[0].trim().replace(/\s+/g, " ").toLowerCase();
    }),
    names: params.map((p) => (p.match(/^(?:inout\s+|in\s+|out\s+)?([A-Za-z_][A-Za-z0-9_]*)/i) || [])[1] || ""),
  };
}

test("migration function input parameter names stay stable for identical PostgreSQL signatures", async () => {
  const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const seen = new Map();
  const re = /create\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*returns/gi;
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    for (const m of sql.matchAll(re)) {
      const sig = signature(m[2]);
      const key = `${m[1].toLowerCase()}(${sig.types.join(",")})`;
      const previous = seen.get(key);
      if (previous) {
        assert.deepEqual(sig.names, previous.names, `${file} renames input parameters for ${key}; use DROP FUNCTION before CREATE if the names truly must change`);
      } else {
        seen.set(key, { names: sig.names, file });
      }
    }
  }
});

test("0070 safely replaces the pre-existing enterprise-mode function signature", async () => {
  const sql = await readFile(join(migrationsDir, "0070_paystack_refund_non_custodial_migration.sql"), "utf8");
  const drop = sql.indexOf("drop function if exists admin_set_merchant_enterprise_mode(text,text,boolean,text);");
  const create = sql.indexOf("create function admin_set_merchant_enterprise_mode(");
  assert.ok(drop >= 0 && create > drop, "0070 must drop the old signature before creating the corrected function");
  assert.match(sql, /p_merchant_id text, p_admin_id text, p_enabled boolean, p_reason text/);
  assert.doesNotMatch(sql, /p_tier text, p_enabled boolean, p_reason text/);
});

test("0074 is safe when upgrading a database that reached an older 0070", async () => {
  const sql = await readFile(join(migrationsDir, "0074_admin_provider_adapter_hardening.sql"), "utf8");
  const drop = sql.indexOf("drop function if exists admin_set_merchant_enterprise_mode(text,text,boolean,text);");
  const create = sql.indexOf("create function admin_set_merchant_enterprise_mode(");
  assert.ok(drop >= 0 && create > drop);
});

test("0077 removes the ambiguous eight-argument payment webhook overload", async () => {
  const sql = await readFile(join(migrationsDir, "0077_webhook_overload_cleanup.sql"), "utf8");
  assert.match(
    sql,
    /drop\s+function\s+if\s+exists\s+apply_payment_webhook\(text,text,text,text,text,numeric,text,text\)\s*;/i,
  );
  assert.match(
    sql,
    /comment\s+on\s+function\s+apply_payment_webhook\(text,text,text,text,text,numeric,text,text,text\)/i,
  );
});
