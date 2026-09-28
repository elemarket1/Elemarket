# ELEMARKET production CTO follow-up

Base: `164a867e4392ec5b5588ebd05f98527837fa11af`. This report covers the follow-up patch; earlier provider fixes remain in the branch. Production readiness is **not** claimed.

## P0 — MUST FIX BEFORE LAUNCH

**No installed payment adapter provides the required provider-controlled settlement contract.** ELEMARKET must not hold customer funds, and merchants may withdraw only after delivery plus 24 hours without a dispute. Local database eligibility cannot govern withdrawals through a provider's own dashboard. Production activation, startup and initialization therefore remain blocked. A real provider contract covering delivery notification, dispute freeze, release ordering/idempotency and unknown-outcome reconciliation must be implemented and certified. Paystack remains a real adapter; Hubtel has not been implemented or fabricated. Neither a generic HTTP endpoint nor a SQL flag grants settlement capability.

`release:verify` was actually executed and failed. A first unconfigured run stopped at ingress configuration. A complete **synthetic selected-provider fixture** reached the financial capability gate and exited1; `scripts/start.mjs` rejected the same fixture. These are verified fail-closed results, not a successful production release or live-provider certification.

## P1 — SHOULD FIX BEFORE LAUNCH

- Mobile `npm audit` reports **3 moderate affected-package entries** in one `decode-uri-component → query-string → expo-router` dependency chain ([advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)). No high/critical vulnerabilities were reported. The patched decoder0.5.0 uses an incompatible ESM interface for the installed CommonJS consumer; no forced incompatible override/downgrade was applied. The inspected router call sites use stringification, but a full native reachability/security assessment was not performed. Obtain an SDK-compatible upstream fix or a reviewed backport before mobile launch.
- Configure separate migration/configuration and restricted application DB roles in the actual deployment. Runtime now rejects elevated roles, writable provider capability/configuration tables and public-schema CREATE. The permission policy was exercised on PostgreSQL with real temporary roles; the connected production database was not accessed.
- Actual Render deployment, live payment/refund/webhook/provider behavior, external storage CORS/signatures, delivery/KYB contracts and native signed-device testing remain unverified. No deployment credentials/provider accounts were supplied. Existing emulator compatibility limitations remain: required public HTTPS checks are not bypassed to point the application at a local HTTP mock.
- CodeRabbit review was retried, but the tool returned **review disabled for this task**. No review findings or approval can be claimed.

## P2 — TECHNICAL DEBT

- Root lint has **30 warnings, zero errors**. Existing unused bindings and hook dependency warnings remain.
- Most provider capabilities have one installed adapter. Future adapters need real contracts and certification. S3 role/session credential acquisition is not implemented.
- The transaction-local telemetry fix increases counter row count. Existing90-day retention is retained; aggregate with `SUM(value)` by metric/minute and monitor volume. This preserves exact committed totals and avoids financial lock contention.
- The production build still reports the upstream PGlite direct-eval bundler warning. No application dynamic module import was introduced.

## FIXED

### Architecture and provider assumptions

- Extracted Typesense wire format, headers, filters and response mapping out of core search into `SearchProvider`, static registry and adapter. `ELEMARKET_SEARCH_PROVIDER` defaults to PostgreSQL; credentials alone no longer activate an external service. Unknown providers fail closed, selected missing credentials fail clearly, first-page failures fall back to authoritative SQL, and provider cursor failures require restarting the search.
- Removed the unregistered generic HTTP payment implementation. It was not a real Hubtel integration. Core retains the payment interface and the explicitly isolated preview adapter.
- Production catalog gating now distinguishes configured historical aliases from active collection channels: historical driver credentials remain available for reconciliation; DB validation checks the hold capability on every active alias. Active collection is still impossible with the current installed financial capabilities.
- Added explicit transactional `npm run providers:configure -- <approved-json>` activation. It checks aliases, installed drivers, credentials, methods, migration state and capabilities; upserts supplied aliases idempotently without silently disabling historical providers or creating adapter guarantees.
- Removed the unnecessary mandatory `REDIS_URL` startup requirement. Existing PostgreSQL rate limiting is the durable fallback. Selected Redis REST/native transports retain their own validation.

### Security

- Introduced one bounded public HTTPS transport for configurable storage, delivery, KYB, optional search, enterprise/brand connectors, security alerts and Redis REST. It validates DNS results and pins the chosen address for the TLS connection, preserves hostname verification, rejects private/reserved and mixed answers, blocks redirects and nonstandard ports, and bounds DNS/socket/body duration and response bytes.
- Fixed embedded6to4 address validation and rejected additional non-public IPv6/IPv4 ranges. Request-body and storage upload policies were not weakened.
- Security alert webhooks no longer serialize arbitrary message/metadata fields and no longer follow redirects. Only explicit event fields are sent externally.
- `RENDER=true` no longer downgrades TLS for arbitrary external PostgreSQL/Redis hosts. Existing private-host handling is confined to the configured private host forms.
- Canonical environment validation closes uppercase/whitespace selection inconsistencies at the capability gate.
- Mobile authentication requests cannot follow credential redirects. Cleartext loopback is development-only; URL credentials/non-HTTP schemes are rejected, and abort listeners are cleaned up.
- Database runtime-role checks reject superuser/bypass-RLS/create-role/create-DB privileges, provider/migration configuration writes, configuration ownership and public-schema creation.

### Database and migrations

All **138 migrations present at this follow-up's base remain byte-identical**. Three forward migrations produce **141 total**:

1. `0140_payment_driver_binding_lock.sql`: share-lock the provider row during first-payment driver binding, preventing concurrent reassignment. Ownership/driver immutability remains enforced.
2. `0141_security_definer_search_paths.sql`: pin all public definer functions to `pg_catalog,public,pg_temp`; revoke schema CREATE from PUBLIC. Authorization and function bodies remain intact.
3. `0142_transaction_local_observability_counters.sql`: fix a reproduced expiry/webhook deadlock caused by global telemetry-row locks. Counters are grouped by transaction, preserving all committed increments; durable audit/event rows and financial state transitions remain unchanged.

The migrator rejects missing/incomplete manifests, duplicate numbers, checksum drift and absent shared database configuration. Fresh databases were migrated in integration tests; activation and replay, capability mismatch, credential mismatch and restricted/elevated role behavior were checked. No vendor branch was found in the tested active financial SQL definitions. Historical provider-specific migrations were preserved. No live database migration was performed.

### Dependency repair

- Added direct production `srvx`; moved directly imported Nitro into production dependencies and build-only Tailwind tooling into development dependencies.
- Removed35 unused root template dependencies, reducing the installed root packages from429 to309. Root audit: zero vulnerabilities. Production-only install and `srvx/node`/`pg` imports passed.
- Added a regression that checks direct server/application imports against production dependencies.
- Added mobile lockfile and Node22 engine declaration; aligned native modules to the selected Expo55.0.31 bundled compatibility manifest, with matching React DOM/web peers. Initial peer conflicts were resolved without force/legacy-peer options.
- Scoped xcode's UUID dependency to11.1.1; actual UUID generation passed. Mobile advisories dropped from14 affected-package entries to3; the remaining chain is disclosed above.

### Docker

The first image build succeeded but its startup smoke found a missing transitive `fcm-browser.mjs` import. Docker now copies the provider-policy metadata and runtime role validator, uses `build:production`, and accepts only public push/browser configuration through build arguments. Server secrets are runtime-only. The corrected image was checked separately; see final validation addendum below for the final image result.

## Tests actually executed

All root commands ran with Node22.23.3/npm10.9.9 from the repository root unless a different directory is stated. PostgreSQL16 used disposable local synthetic fixtures.

| Command / check | Observed result |
|---|---|
| `mise exec node@22 -- npm ci` | Passed after root dependency changes;309 installed packages,0 reported vulnerabilities |
| `mise exec node@22 -- npm ls --all` | Passed; optional absent peers are non-required |
| `mise exec node@22 -- npm run security:ci` | Passed;0 vulnerabilities,309 verified package signatures,130 attestations |
| `RUN_DB_INTEGRATION=1 ELEMARKET_INTEGRATION_DATABASE_URL=<disposable-local-db> mise exec node@22 -- npm test` | Final **858 passed,0 failed,0 skipped** |
| Counter/financial concurrency targeted tests |12 passed,0 failed; real simultaneous PostgreSQL connections |
| Runtime activation/DB roles and selected provider/search targeted run |25 passed,0 failed |
| Root `npm run typecheck` | Passed |
| Root `npm run lint` | Passed;0 errors,30 warnings |
| Root `npm run build:production` | Passed; final container also uses this build command |
| `DATABASE_URL=<disposable-local-db> ELEMARKET_ENV=development npm run db:migrate` | Three new migrations applied; fresh-chain tests passed; final checksum/replay verified in addendum |
| `npm ci --omit=dev --ignore-scripts` in `/tmp/elemarket-production-install` | Passed; production dependency tree and srvx/pg imports resolved |
| Mobile `npm ci --ignore-scripts` | Passed after SDK alignment and scoped UUID fix |
| Mobile `node node_modules/expo/bin/cli install --check` | Dependencies up to date |
| Mobile `npm run typecheck` | Passed after mobile transport fixes |
| Mobile `npm ls --all` | Passed |
| Mobile `npm audit signatures` | Passed;673 signatures,148 attestations |
| Mobile `npm audit --json` | Exit1;3 moderate entries,0 high/critical; unresolved |
| Mobile Xcode UUID generation | Passed using installed overridden dependency |
| Mobile `node node_modules/expo/bin/cli export --platform android --output-dir /tmp/elemarket-mobile-export` | Passed; Android Hermes bundle produced. No signed binary/device test or live API startup claimed |
| `npm run release:verify` and `node scripts/start.mjs` with production fixture | Exit1 at missing deliveryDisputeHold; release remains blocked |
| `coderabbit review --agent -t uncommitted` | Blocked: review disabled; no review performed |

Failure history was retained: obsolete source assertions were updated after adapter extraction; duplicate TypeScript exports/undefined driver typing were corrected; initial mobile dependency resolution failed; initial container startup missed metadata; an intermittent real counter deadlock was reproduced and fixed. The old test that deliberately expected shared-counter blocking was replaced with a stronger assertion that refund completion finishes while an unrelated transaction holds a counter increment open. Financial outcome assertions remain.

## Render startup dependency graph

```text
npm ci
  -> build:production
     -> selected browser adapter's PUBLIC build configuration only
     -> Vite/Nitro output
  -> release job using migration/configuration owner
     -> DATABASE_URL + migration manifest/checksums
     -> migrations0140/0141/0142
     -> explicit approved payment alias activation + merchant account setup
  -> restricted runtime DATABASE_URL
     -> explicit canonical environment + auth/encryption/job/ingress configuration
     -> selected provider requirements only
     -> payment settlement-capability gate [BLOCKED today]
     -> restricted DB role + complete migrations + active/historical driver bindings
     -> application readiness
```

Redis is optional; the PostgreSQL limiter is always available as the durable fallback. Push can be disabled, KYB can use manual review, storage can use generic S3. Required marketplace location/email/OTP features still require a selected installed adapter; no substitute adapter was fabricated. On Docker, selected FCM public browser values must be supplied at build time. Actual Render deployment was not performed.

## SAFE/INTENTIONAL PROVIDER REFERENCES

The final scan covers every tracked/non-ignored new source/configuration/documentation/lockfile, plus active SQL definitions through DB tests. `provider-references.csv` gives every matched file, line, provider/endpoint, classification, reason, adapter locality, historical flag and fix flag. Adapter endpoints/protocols, explicit registries, selected configuration, immutable history/seeds and provider tests remain intentional. Architecture classification does not declare vulnerable dependency versions safe: the mobile advisory is tracked separately.

Artifacts: `files-changed.txt`, `environment-matrix.csv`/`.md` (100 variables/templates with use sites, required conditions, secrecy, defaults and omission rules), `provider-references.csv`, `scan-summary.json`. All environment values are excluded.

## Final validation addendum

The final Docker image built successfully with `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/elemarket-docker/docker.sock DOCKER_BUILDKIT=0 docker build --network host -t elemarket:provider-cto-fix .` (exit0). It runs as `node`. Final image: `sha256:bcb8426167e26c247611f5f41db6a91714f8315ecc282fbdf9bb586634314c86`. Both unconfigured and synthetic production-fixture container runs exited1 at their expected gates, and neither had missing-module errors. Startup smoke runs use `--network none` and check for the expected configuration/financial gate, rejecting missing-module failures. All141 migration checksums were verified;138 baseline files remain unchanged; replay reports up to date. Final rescan:551 files,2449 references,0 unclassified. Final full suite:858 passed,0 failed,0 skipped; lint:0 errors,30 warnings.

Upgrading a real database with historical payments bound to an unavailable legacy driver may require provider-specific reconciliation before retiring credentials or changing aliases. The migration does not rewrite those historical financial bindings, and no production data was inspected.

## Delivery status

Local commit `ac1994ea67da27c1fffb752a9b3b61b3a31f8840` contains62 changed files. `git push origin HEAD:refs/heads/coderabbit/provider-neutral-architecture/ca0bfa9d` failed with HTTP403: GitHub denied write access to coderabbitai[bot]. This commit is **not published to GitHub**. Restore repository write access to publish it. The downloadable repository ZIP and patch contain all current fixes.
