/** Runtime must not be able to grant itself provider or migration capabilities. */
export async function validateRuntimeDatabaseRole(connection) {
  const privileges = await connection.query(`
    select
      rolsuper,
      rolbypassrls,
      rolcreatedb,
      rolcreaterole,

      case
        when to_regclass('public.payment_providers') is not null
        then has_table_privilege(
          current_user,
          'public.payment_providers',
          'INSERT,UPDATE,DELETE'
        )
        else false
      end as provider_write,

      /*
       * payment_driver_capabilities is intentionally optional/obsolete in
       * provider-neutral deployments. Never make runtime startup depend on
       * that table existing.
       */
      case
        when to_regclass('public.payment_driver_capabilities') is not null
        then has_table_privilege(
          current_user,
          'public.payment_driver_capabilities',
          'INSERT,UPDATE,DELETE'
        )
        else false
      end as capability_write,

      case
        when to_regclass('public._migrations') is not null
        then has_table_privilege(
          current_user,
          'public._migrations',
          'INSERT,UPDATE,DELETE'
        )
        else false
      end as migration_write,

      has_schema_privilege(
        current_user,
        'public',
        'CREATE'
      ) as schema_create,

      exists(
        select 1
        from pg_class
        where relname in (
          'payment_providers',
          'payment_driver_capabilities',
          '_migrations'
        )
        and pg_has_role(current_user, relowner, 'USAGE')
      ) as configuration_owner

    from pg_roles
    where rolname = current_user
  `);

  if (Object.values(privileges.rows[0] || {}).some(Boolean)) {
    throw new Error(
      'Runtime database role has administrative or provider-configuration write privileges; use a restricted application role',
    );
  }
}
