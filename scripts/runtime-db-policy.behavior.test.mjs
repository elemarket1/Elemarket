import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeDatabaseRole } from './runtime-db-policy.mjs';

function connection(row) {
  return { query: async () => ({ rows: [row] }) };
}

test('Render managed DB owner privileges warn but do not block startup', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await validateRuntimeDatabaseRole(connection({ rolsuper:false, rolbypassrls:false, rolcreatedb:true, rolcreaterole:true, provider_write:true, capability_write:true, migration_write:true, schema_create:true, configuration_owner:true }), { RENDER:'true' });
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
});

test('Non-Render privileged runtime roles remain blocked', async () => {
  await assert.rejects(
    () => validateRuntimeDatabaseRole(connection({ rolsuper:false, rolbypassrls:false, rolcreatedb:true, rolcreaterole:false, provider_write:false, capability_write:false, migration_write:false, schema_create:false, configuration_owner:false }), { RENDER:undefined }),
    /administrative or provider-configuration/
  );
});

test('Superuser remains blocked even on Render', async () => {
  await assert.rejects(
    () => validateRuntimeDatabaseRole(connection({ rolsuper:true, rolbypassrls:false, rolcreatedb:false, rolcreaterole:false, provider_write:false, capability_write:false, migration_write:false, schema_create:false, configuration_owner:false }), { RENDER:'true' }),
    /administrative or provider-configuration/
  );
});
