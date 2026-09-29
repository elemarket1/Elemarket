/**
 * Validate the runtime PostgreSQL connection without assuming that a managed
 * hosting database exposes a separately restricted application role.
 *
 * Render's managed PostgreSQL connection role can legitimately report
 * CREATEDB/CREATEROLE and CREATE on public. Those privileges are not by
 * themselves proof that the application is a PostgreSQL superuser.
 *
 * The startup gate therefore fails only on privileges that make the runtime
 * connection equivalent to an unrestricted database administrator:
 *   - SUPERUSER
 *   - BYPASSRLS
 *
 * The remaining managed-host privileges are reported as warnings so they are
 * visible in production logs without preventing the service from booting.
 */
export async function validateRuntimeDatabaseRole(connection) {
  const result = await connection.query(`
    select
      rolsuper,
      rolbypassrls,
      rolcreatedb,
      rolcreaterole,
      has_schema_privilege(current_user, 'public', 'CREATE') as schema_create
    from pg_roles
    where rolname = current_user
  `);

  const role = result.rows[0];

  if (!role) {
    throw new Error("Unable to resolve current PostgreSQL runtime role");
  }

  const fatal = [];

  if (role.rolsuper === true) fatal.push("rolsuper");
  if (role.rolbypassrls === true) fatal.push("rolbypassrls");

  if (fatal.length) {
    throw new Error(
      `Runtime database role has forbidden unrestricted privileges: ${fatal.join(", ")}`,
    );
  }

  const managedWarnings = [];

  if (role.rolcreatedb === true) managedWarnings.push("rolcreatedb");
  if (role.rolcreaterole === true) managedWarnings.push("rolcreaterole");
  if (role.schema_create === true) managedWarnings.push("schema_create");

  if (managedWarnings.length) {
    console.warn(
      JSON.stringify({
        event: "startup.database_role_privilege_warning",
        privileges: managedWarnings,
        message:
          "Managed PostgreSQL role has additional privileges; startup gate permits them because SUPERUSER and BYPASSRLS are false.",
      }),
    );
  }
}
