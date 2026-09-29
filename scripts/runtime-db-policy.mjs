/**
 * Validate the runtime DB role without making Render's managed owner role
 * impossible to use. Render's default database role commonly owns the schema
 * and therefore reports CREATE/CREATEDB/CREATEROLE and table ownership even
 * when it is not a PostgreSQL superuser and cannot bypass RLS.
 *
 * Those managed-owner privileges are warnings on Render, while SUPERUSER and
 * BYPASSRLS remain hard failures. In non-Render environments the strict policy
 * remains in force so a deliberately scoped application role is required.
 */
export async function validateRuntimeDatabaseRole(connection, environment = process.env) {
    const privileges = await connection.query(`select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
      has_table_privilege(current_user,'payment_providers','INSERT,UPDATE,DELETE') as provider_write,
      has_table_privilege(current_user,'payment_driver_capabilities','INSERT,UPDATE,DELETE') as capability_write,
      has_table_privilege(current_user,'_migrations','INSERT,UPDATE,DELETE') as migration_write,
      has_schema_privilege(current_user,'public','CREATE') as schema_create,
      exists(select 1 from pg_class where relname in ('payment_providers','payment_driver_capabilities','_migrations') and pg_has_role(current_user,relowner,'USAGE')) as configuration_owner
      from pg_roles where rolname=current_user`);
    const row = privileges.rows[0] || {};
    if (row.rolsuper || row.rolbypassrls) {
      throw new Error('Runtime database role has administrative or provider-configuration write privileges; use a restricted application role');
    }
    const managedPrivileges = Boolean(row.rolcreatedb || row.rolcreaterole || row.provider_write || row.capability_write || row.migration_write || row.schema_create || row.configuration_owner);
    if (managedPrivileges) {
      if (environment.RENDER === 'true' || environment.RENDER === '1') {
        console.warn(JSON.stringify({
          event: 'startup.database_role_privilege_warning',
          reason: 'Render managed database roles may own the application schema; superuser and BYPASSRLS remain prohibited',
        }));
        return;
      }
      throw new Error('Runtime database role has administrative or provider-configuration write privileges; use a restricted application role');
    }
}
