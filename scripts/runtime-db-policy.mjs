/**
 * Validate the database role used by the application.
 *
 * Render Free has no separate pre-deploy/release role, so the same managed
 * PostgreSQL role must be able to apply migrations during startup. We still
 * fail closed for SUPERUSER/BYPASSRLS and surface the additional managed-role
 * privileges as a warning instead of pretending a restricted role exists.
 */
export async function validateRuntimeDatabaseRole(connection, { migrationCapable = false } = {}) {
  const result = await connection.query(`select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
    has_table_privilege(current_user,'payment_providers','INSERT,UPDATE,DELETE') as provider_write,
    has_table_privilege(current_user,'payment_driver_capabilities','INSERT,UPDATE,DELETE') as capability_write,
    has_table_privilege(current_user,'_migrations','INSERT,UPDATE,DELETE') as migration_write,
    has_schema_privilege(current_user,'public','CREATE') as schema_create,
    exists(select 1 from pg_class where relname in ('payment_providers','payment_driver_capabilities','_migrations') and pg_has_role(current_user,relowner,'USAGE')) as configuration_owner
    from pg_roles where rolname=current_user`);
  const row = result.rows[0] || {};
  if (row.rolsuper || row.rolbypassrls) {
    throw new Error('Runtime database role must not be SUPERUSER or BYPASSRLS');
  }
  const extra = ['rolcreatedb','rolcreaterole','provider_write','capability_write','migration_write','schema_create','configuration_owner']
    .filter((key) => row[key] === true);
  if (extra.length) {
    if (!migrationCapable) {
      throw new Error(`Runtime database role has administrative or provider-configuration write privileges: ${extra.join(', ')}; use a restricted application role`);
    }
    console.warn(JSON.stringify({
      event: 'startup.database_role_privilege_warning',
      privileges: extra,
      message: 'Render Free inline migration mode requires the managed database role to retain migration privileges; SUPERUSER and BYPASSRLS are still forbidden.'
    }));
  }
}
