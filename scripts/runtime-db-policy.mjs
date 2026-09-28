/** Runtime must not be able to grant itself provider or migration capabilities. */
export async function validateRuntimeDatabaseRole(connection) {
    const privileges = await connection.query(`select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
      has_table_privilege(current_user,'payment_providers','INSERT,UPDATE,DELETE') as provider_write,
      has_table_privilege(current_user,'payment_driver_capabilities','INSERT,UPDATE,DELETE') as capability_write,
      has_table_privilege(current_user,'_migrations','INSERT,UPDATE,DELETE') as migration_write,
      has_schema_privilege(current_user,'public','CREATE') as schema_create,
      exists(select 1 from pg_class where relname in ('payment_providers','payment_driver_capabilities','_migrations') and pg_has_role(current_user,relowner,'USAGE')) as configuration_owner
      from pg_roles where rolname=current_user`);
    if (Object.values(privileges.rows[0] || {}).some(Boolean)) throw new Error('Runtime database role has administrative or provider-configuration write privileges; use a restricted application role');
}
