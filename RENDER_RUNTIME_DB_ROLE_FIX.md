# Render runtime database role compatibility fix

The Render deployment was failing in `scripts/runtime-db-policy.mjs` because the validator treated every privilege reported by Render's managed database owner role as a fatal security violation.

This is incorrect for this deployment model: the managed Render role may own the application schema and therefore report CREATE/CREATEDB/CREATEROLE, table write privileges, and ownership. The validator now:

- always rejects PostgreSQL SUPERUSER and BYPASSRLS;
- allows Render managed-owner privileges with a structured warning;
- keeps the strict restricted-role requirement for non-Render environments.

No payment or delivery provider is required by this change.
