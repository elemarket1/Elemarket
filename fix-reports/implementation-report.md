# ELEMARKET provider architecture implementation

Base revision: `014f3c1f519e6d7401b059b21fa6de1fb76afc5f`. Changes are in the workspace; nothing was deployed or pushed. **Production readiness is not claimed.**

## P0 — MUST FIX BEFORE PRODUCTION

A real payment adapter/provider contract must enforce merchant withdrawal only after confirmed delivery plus 24 hours without a customer dispute, including the provider's own dashboard and race/retry behavior. The installed adapter cannot provide this. Production startup and payment initialization now reject the missing `deliveryDisputeHold` capability. Staging retains explicitly declared uncontrolled settlement solely for isolated tests without customer funds. ELEMARKET custody/escrow was not introduced. A database eligibility result is not a provider settlement guarantee.

Hubtel is **not implemented**. No generic HTTP adapter is represented as Hubtel, and no endpoints, signature scheme or settlement behavior were invented. Its real external API contract is needed before adding a reviewed static factory.

## P1 — SHOULD FIX BEFORE LAUNCH

- Complete live sandbox certification for selected payment, storage, email, OTP, location, push, KYB and delivery integrations. Fixture tests verify local contracts, not external account permissions, settlement timing or real service behavior.
- Run an actual Render deployment after the required settlement adapter exists. Only Render-specific configuration validation was exercised here; no Render service was deployed.
- CodeRabbit review was attempted but is disabled for this coding task. No review findings or clean-review claim are available.
- Outbound public-address DNS checks and redirect rejection remain enforced. The existing check-then-fetch approach does not pin DNS across resolution and connection; DNS rebinding resistance and deployment egress restrictions require additional hardening before treating arbitrary merchant-controlled endpoints as fully isolated.

## P2 — TECHNICAL DEBT

- Most categories currently have one real adapter. Registries support reviewed additions; this does not mean other vendors are implemented.
- S3-compatible storage currently uses configured access keys. IAM role/session credential acquisition is not implemented.
- Thirty lint warnings remain (zero errors).
- Deployment must supply ICE/STUN infrastructure when cross-network peer connections are needed; unsolicited public STUN defaults were removed.

## SAFE / INTENTIONAL REFERENCES

The post-change inventory classifies every matched file/line/reference. “Safe in architecture” means the reference is intentional in its layer, **not** that the entire adapter is production-certified. The scan includes tracked and non-ignored new files, hidden deployment/CI configuration, TypeScript/JavaScript, SQL, scripts, frontend/mobile, package metadata/lockfile and operational documentation. Binary files were enumerated; text was decoded for matching. Searches cover requested vendor names, URLs and discovered infrastructure names including Neon, Redis/Valkey, Upstash, Google, Render and Vercel. English “resend”/React “render” false positives are identified as ordinary copy/comments.

- Real adapter endpoints, signatures, schemas, OAuth scopes, protocol constants and attribution remain in adapters.
- Provider identifiers/requirements remain in static registries and configuration.
- Package provenance, CI references and platform-specific TLS/proxy handling are security-sensitive dependencies, not mandatory business vendors.
- Historical migration names/data remain unchanged. Active replacement SQL uses capabilities.
- Standard namespace/schema/license URLs remain intentional.

See `provider-references-after.csv` for FILE, LINE, VENDOR, A–J classification, reason, safety, adapter-local/historical flags and whether another architecture fix is needed. `provider-references-before.csv` records the baseline. No unmatched reference remains unclassified. Inventory counts are reference matches, not a claim that each baseline match was a distinct bug.

## A. Files changed

83 files were modified or added. `files-changed.txt` is the complete list. Main groups:

| Area | Changes |
|---|---|
| Provider configuration | Shared catalog and browser policy; static allowlists; selected-provider credential validation |
| Payments | Typed capabilities, runtime driver validation, adapter-owned checkout/signature metadata, capability-based merchant-account/refund logic |
| Storage | Configured regional S3-compatible signer, R2 compatibility adapter, separate registry; canonical signed-header ordering and bounded streaming reads |
| Location | Separate contract/registry/Geoapify adapter, provider-scoped cache and configured linked attribution |
| Auth | Selected email/OTP factories; adapter-owned email webhook verification and OTP sender/template configuration; provider-neutral email challenge queries |
| Push/KYB | Static registries and client selection; normalized transport failures; provider-bound tokens and atomic ownership protection; KYB adapter isolation |
| Runtime/security | Selected browser CSP origins, strict origin parsing, safe preview checkout URLs, delivery/KYB/storage public endpoint checks, no public font/STUN defaults; PostgreSQL naming |
| Deployment/DB/tests | Three forward migrations, checksums, Docker catalog copying, build/start separation, docs, regression and database tests |

## B. Exact hard-codes removed

- Unconditional startup requirements for Geoapify, Arkesel, R2 and default Resend/FCM secrets; only selected adapter requirements apply.
- Paystack-only checks in the startup script; the central allowlist describes the actually installed driver and its capabilities.
- Payment core's `providerKey === "paystack"` checkout hostname fallback and `driver_key === "paystack"` merchant-account rule.
- Route-level `x-paystack-signature` handling; signature extraction belongs to the adapter.
- Environment-controlled payment module imports and automatic generic HTTP payment adapter selection.
- Active SQL `v_payment.driver_key='paystack'` late-refund branch, via a new migration.
- R2 construction/import in storage core; configured S3-compatible endpoint/region supported.
- Geoapify transport/schema/cache literal in location core and the database's Geoapify-only constraint.
- Resend literals in OTP SQL and vendor-specific uniqueness indexes; Svix authentication moved to the email adapter.
- Arkesel sender/message environment access in OTP core.
- Fylings direct import by the KYB domain.
- FCM error codes/client import in notification core/UI; endpoints are adapter metadata used by browser policy.
- Security-header defaults for server-side Paystack/Geoapify APIs; unrestricted raw CSP override interpolation.
- Paystack/PaySmall Small UI labels, public Google/Cloudflare STUN defaults, external font requests and misleading Neon-specific PostgreSQL naming.

## C. Remaining intentional references

The CSV is the complete file-and-line ledger. Adapter implementations and static registry/configuration references remain. Database seeds are not evidence of an installed native provider integration. The delivery adapter implements ELEMARKET's existing JSON quote protocol; no native carrier API was invented. Financing continues to use approved database configuration and provider handoff boundaries.

## D. Database changes

- `0137_provider_capability_boundaries.sql`: reviewed driver refund capability table; replacement active webhook function retains financial locks, replay checks and immutable ownership/reference bindings; general location provider constraint; provider-neutral email challenge indexes.
- `0138_push_provider_binding.sql`: backfill existing tokens to their historical transport and require explicit provider ownership for new tokens.
- `0139_withdrawal_delivered_status.sql`: require current delivered/completed state as well as the existing delivery history, 24-hour and dispute rules.

## E. Environment-variable changes

No production credentials or workaround environment variables were added.

- New neutral storage configuration: `ELEMARKET_STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- Existing R2 credentials remain necessary only when `r2` is selected.
- Location/email/OTP selections must be explicit; their installed adapters retain their existing credential names.
- `ELEMARKET_KYB_PROVIDER` selects `fylings` or the existing `manual` review workflow. Push supports `disabled` and selected FCM.
- Existing selected delivery alias/endpoint/secret are validated at startup. Only selected alias credentials are required.
- Payment aliases retain driver-specific requirements; `_CHECKOUT_HOSTS` defaults come from installed driver metadata. Arbitrary module environment variables are no longer executable configuration.
- Production requires `provider_delivery_hold` **and** an actual installed capability; the mode alone cannot enable it.
- Build validates only selected public browser configuration. Startup owns runtime secrets/capability checks. Docker now copies the shared registry metadata required by startup.

## F. Tests executed and exact results

All commands ran from the repository with Node 22.23.3/npm 10.9.9 through `mise exec node@22 --`. PostgreSQL checks used a disposable local PostgreSQL 16 database, not production data.

| Check | Observed result |
|---|---|
| `RUN_DB_INTEGRATION=1 ELEMARKET_INTEGRATION_DATABASE_URL=<disposable DB> npm test` | **841 passed, 0 failed, 0 skipped** |
| `ELEMARKET_INTEGRATION_DATABASE_URL=<disposable DB> npm run test:integration:concurrency` after final database naming cleanup | **71 passed, 0 failed, 0 skipped** |
| `node --test scripts/provider-architecture.behavior.test.mjs scripts/fcm-client-contract.test.mjs scripts/production-startup.behavior.test.mjs scripts/provider-neutral-driver-registry.test.mjs` after final registry cleanup | **33 passed, 0 failed, 0 skipped** |
| New runtime startup/database integration test, with DB enabled | **1 passed, 0 failed, 0 skipped**; fresh full migrations, alias credentials, missing capability row, mismatched capability and missing migration rejection |
| Provider database regressions | **5 passed, 0 failed** (included in full suite): actual active SQL, location constraint, cross-provider email OTP uniqueness, token ownership race/provider binding, withdrawal/dispute/no-custody behavior |
| `npm run lint` | **0 errors, 30 warnings**; subsequent changed files passed targeted ESLint |
| `npm run security:ci` | **0 vulnerabilities**; **429** verified registry signatures, **191** verified attestations |
| `git diff --check` | Passed |
| `coderabbit review --agent -t uncommitted` | **Blocked: review disabled for this task.** No review executed. |

Early test runs failed: first unit/contract pass had 716 passing, 23 failing, 58 skipped; second had 743 passing, 1 failing, 58 skipped. Failures involved moved-source assertions, capability fixtures and one relative path and were corrected. Added DB tests initially had fixture schema/membership/delivery-confirmation errors; fixtures were corrected to use real authorized database flows. Final results above supersede those failures. Validation reuse was limited to unchanged inputs; final targeted passes cover later changes.

## G. Build/typecheck

`npm run typecheck`: passed. `npm run build:production`: passed after the final provider metadata change. The Vite/Nitro server bundle was produced without adding runtime provider secrets to the build. Build success does not override the production settlement gate.

## H. Migration status

**135 historical migration checksums are unchanged. Three new migrations bring the manifest to 138 files.** The full chain and forward additions applied successfully on PostgreSQL 16. Re-running `npm run db:migrate` reported up to date. The independent startup database test also built a fresh database from the full chain. No remote/Render database was migrated.

## I. Render startup dependency graph

```text
npm ci
  -> build:production
       -> selected push browser configuration
       -> Vite/Nitro build
  -> preDeploy: db:migrate
       -> PostgreSQL + checksum verification + migration lock
  -> start.mjs
       -> universal auth/secrets/ingress/DB TLS/Redis validation
       -> explicit selected provider configuration
       -> required settlement capability (currently BLOCKED)
       -> migration/pinned driver/capability consistency
       -> Nitro server -> health readiness
```

No unused vendor credentials are required. Unsupported or unconfigured selections fail clearly. Existing Render-specific database/Redis validation tests pass. An actual Render deployment was not run.

## J. Verification limits and follow-up

The tagged CodeRabbit emulator catalog was installed and inspected. It includes AWS S3 and Resend, but local HTTP/private endpoints conflict with the storage public-HTTPS/SSRF policy, and the Resend adapter does not expose an endpoint override. It has no matching Paystack, Geoapify, Arkesel, FCM messaging or Fylings service. No test bypass was added to production code. Live provider smoke checks remain outstanding. Official web lookup was unavailable in this environment; existing provider contracts were preserved rather than invented.

Production can proceed only after the P0 external settlement contract is implemented and verified, followed by live integration, security review and deployment checks.
