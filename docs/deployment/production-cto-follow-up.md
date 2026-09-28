# Production follow-up and release procedure

## Financial release gate

The installed payment driver still cannot enforce provider-side release only after delivery plus 24 dispute-free hours. Production startup, activation and payment creation fail closed. No fake Hubtel adapter or provider-managed settlement guarantee was added. A signed-off real settlement/reconciliation contract and its adapter are required before launch. ELEMARKET does not take custody of customer funds; disabled escrow and withdrawal actions remain disabled.

Configured historical aliases remain necessary for refunds/webhooks and must retain their original driver and secrets. The catalog requires an installed hold-capable driver before production can proceed, and database validation requires every **active** collection alias to have that capability. Historical inactive aliases are not new collection channels.

## Provider activation on a fresh database

1. Use the database migration owner to run `npm ci` and `npm run db:migrate`. All historical migration bytes are preserved. The migrator rejects incomplete manifests, duplicate numbers, checksum drift and missing shared database configuration.
2. Prepare an approved JSON array outside the webroot, e.g. `[{"providerKey":"processor","name":"Processor","method":"mobile_money"}]`. This file contains no secrets. The alias must be declared in `ELEMARKET_PAYMENT_PROVIDERS`, with its installed `_DRIVER` and `_SECRET` already configured. Method must be supported by the adapter.
3. Run `npm run providers:configure -- /path/to/approved-providers.json` using the migration/configuration owner. The operation checks migrations and capabilities, serializes with migrations, and atomically upserts only supplied aliases. It never deactivates other aliases or grants capabilities. Replays are safe; historical drivers cannot be reassigned. Production rejects the current adapter's missing financial capability; staging requires explicit settlement mode and synthetic funds only.
4. Configure merchant accounts using the existing authorized merchant onboarding workflow. Activating a provider alias does not certify the external API, set up merchant subaccounts, or approve settlement.
5. Start the web app with a separate restricted PostgreSQL role. It must have CONNECT, public schema USAGE, application table/sequence permissions and required function execution, but no administrative flags, no public schema CREATE, no ownership/inherited ownership of configuration tables, and no INSERT/UPDATE/DELETE on `_migrations`, `payment_providers`, or `payment_driver_capabilities`. Table SELECT is required for those three. Apply default privileges appropriately for future application tables. Never grant membership in the migration owner role. Runtime validation checks these constraints.

For Render, execute migrations/activation in a release job with owner credentials and give the web service the restricted role through its existing `DATABASE_URL`. The checked-in preDeploy command is suitable only when its execution environment supplies migration credentials; do not deploy the web process as owner. A plain database after migrations has no active real provider: activation is an explicit release operation.

## Security and protocol changes

- Configurable public HTTPS traffic (storage, delivery, KYB, search, enterprise/brand connectors, alert sink, Redis REST) uses a shared bounded transport. The validated DNS address is used by the TLS connection without another DNS lookup; certificate verification retains the original hostname. Private/reserved answers, mixed DNS answers, redirects and nonstandard ports are rejected. Deadlines include DNS and body reads. Existing private native Redis/PostgreSQL connections remain explicit infrastructure configuration.
- `RENDER=true` no longer permits cleartext Redis or unverified PostgreSQL on arbitrary external hosts. The existing private Render host patterns retain their documented handling; external PostgreSQL requires verify-full and external native Redis requires TLS.
- Alert webhooks receive only event identifiers, severity, service and timestamp. Arbitrary message/metadata fields are excluded from that external payload.
- Forward migration 0140 locks the provider record during first-payment driver binding. Migration 0141 fixes SECURITY DEFINER search paths and revokes public schema CREATE from PUBLIC. Existing financial functions and authorization rules are retained.
- The unused generic HTTP payment implementation was removed. The real adapter registry remains explicit; no generic protocol is represented as a native vendor integration.

## Optional search

PostgreSQL is the default. Select `ELEMARKET_SEARCH_PROVIDER=typesense` only when using the installed external search adapter; then `TYPESENSE_HOST` and `TYPESENSE_SEARCH_KEY` are required. Former implicit activation from credentials has been removed. Vendor wire fields and filter grammar live in the adapter. External failure falls back to authoritative PostgreSQL search; stale external pages are not continued as PostgreSQL cursors. Filter literals containing backticks/backslashes fall back safely rather than introducing provider query operators.

## Dependency and validation boundaries

`srvx` is now a direct production dependency. Nitro is declared in production dependencies because the server imports it. Tailwind build tools are development dependencies. Unused template UI/form/chart libraries have been removed; React DOM remains a framework peer dependency. The production install is checked separately from the full development install. The Expo application's supported dependency versions come from its selected SDK's bundled compatibility manifest, not the newest SDK.

See the accompanying generated report for exact executed checks, remaining launch blockers, complete environment matrix, reference inventory and mobile dependency results. Passing source tests and builds does not certify live provider APIs or a Render rollout.

Docker uses the production build validator. Optional FCM requires selecting it and supplying its public `VITE_FIREBASE_*` configuration as Docker build arguments as well as consistent runtime selection. No server service-account/private credentials are build arguments. The default disabled push build requires none. Never put provider secrets in `VITE_*` values.

Redis is optional: when `REDIS_URL` is absent, the existing PostgreSQL rate-limit function remains the durable shared limiter. `REDIS_HTTP_TOKEN` is required only for the selected HTTPS Redis REST transport. Native Redis credentials come from the selected connection URL. Startup no longer requires an unused Redis service.

## Telemetry lock-order repair

Concurrency testing exposed a global per-minute observability counter lock shared by unrelated payments. Migration0142 adds a transaction identifier to the counter key, preserving every committed increment while preventing cross-order counter locks. Read exact totals with `sum(value)` grouped by `metric_key,bucket_start`; existing retention still deletes by bucket. The repository had no readers relying on a single counter row. Durable event/audit rows, order/payment locks, inventory, disputes and all financial transitions are unchanged. A two-connection regression holds one increment open and proves another transaction can increment the same metric before the first commits, with an exact final sum.
