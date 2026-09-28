/**
 * Validate that the production application connection is not a PostgreSQL
 * superuser/administrative role.
 *
 * Important: Render/managed PostgreSQL commonly uses the same database role
 * for deployment migrations and application runtime. Table ownership and
 * ordinary table DML therefore must NOT be treated as proof that the role is
 * administratively unsafe. The dangerous role attributes are checked
 * explicitly below.
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

  const forbidden = [
    ["rolsuper", role.rolsuper],
    ["rolbypassrls", role.rolbypassrls],
    ["rolcreatedb", role.rolcreatedb],
    ["rolcreaterole", role.rolcreaterole],
    ["schema_create", role.schema_create],
  ];

  const violations = forbidden
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);

  if (violations.length) {
    throw new Error(
      `Runtime database role has forbidden administrative privileges: ${violations.join(", ")}`,
    );
  }
}
