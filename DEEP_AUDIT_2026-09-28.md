# ELEMARKET Deep Audit — 2026-09-28

## Scope

Reviewed the latest provider-neutral build for payment-provider neutrality, non-custodial financial boundaries, merchant withdrawal/dispute concurrency, authentication/authorization, migration integrity, SSRF/outbound transport, storage upload controls, rate limiting, webhook/refund boundaries, enterprise integration controls, and Render production startup configuration.

## Critical finding fixed in this pass

The previous provider-neutralization fixed the authoritative per-order withdrawal function (`merchant_order_withdrawal_eligibility_policy`) but missed the merchant aggregate withdrawal snapshot (`merchant_provider_withdrawal_eligibility_policy`). The latter still queried the historical `escrow_disputes` table.

That created an inconsistency: the merchant finance dashboard could calculate eligibility from legacy escrow records while the authoritative per-order gate used `customer_order_disputes`.

### Fix

Added migration `0145_provider_neutral_merchant_withdrawal_snapshot.sql` which replaces the aggregate function so it:

- reads `customer_order_disputes` only;
- blocks active disputes;
- blocks disputes filed during the 24-hour protection window;
- retains the delivered + 24h requirement;
- remains a read/eligibility calculation only;
- never inserts into local settlement tables;
- never releases escrow;
- never controls provider settlement.

Added regression coverage for this exact boundary.

## Architecture audit

### Payment providers

- Marketplace core does not import a specific payment vendor.
- Provider drivers are statically installed and selected through reviewed deployment configuration.
- Provider-specific credentials remain inside adapters.
- Provider checkout URLs are validated against approved HTTPS hosts.
- Provider initialization uses idempotency.
- Completed webhook payments require provider transaction verification.
- Refunds are bound to payment/order/provider reference records.
- Provider settlement timing is not represented as an ELEMARKET capability.
- No `deliveryDisputeHold`, `provider_delivery_hold`, or `provider_direct_uncontrolled` runtime dependency remains.

### Non-custodial financial boundary

- No active application path performs local customer-fund custody.
- Merchant finance is a marketplace read model plus provider refund/withdrawal eligibility information.
- Legacy escrow migrations remain immutable for database history, but live application paths do not use them.

### Merchant withdrawal policy

Authoritative rule remains:

`delivered -> 24 hours elapsed -> no dispute during the protection window -> no active dispute -> eligible`

The order row is locked during the authoritative per-order decision, and customer dispute creation also locks the order. This preserves serialization against dispute/withdrawal races.

## Security audit

Verified through source/contracts:

- server-side role authorization;
- merchant membership/tenant isolation;
- admin TOTP session assurance;
- sensitive admin operations requiring appropriate capabilities;
- authentication rate limiting;
- state-changing browser requests protected by same-site isolation;
- bearer/native API separation;
- secure production authentication origins;
- secure/httpOnly/SameSite cookies;
- internal-worker nonce + body binding;
- SSRF/public-HTTPS outbound transport controls;
- provider checkout host allowlisting;
- upload ownership binding;
- exact Content-Length binding;
- 560 KiB upload ceiling;
- image-only product media;
- upload finalization state machine;
- push-token account binding;
- refund idempotency and ownership;
- migration checksum validation;
- serialized migration deployment with PostgreSQL advisory locking.

## Migration audit

- Migration manifest checksum validation passed.
- All SQL migration files are represented in the manifest.
- Migration numbering is unique.
- Historical migrations were not rewritten or deleted.
- New migration `0145` is included in the checksum manifest.

## Test status

Full test command discovered **745 tests**.

- 726 passed
- 4 skipped
- 15 failed before test assertions because the supplied ZIP has incomplete `node_modules` (`pg` and `typescript` package entry points are absent).

A clean `npm ci --ignore-scripts` was attempted, but the execution environment timed out during dependency installation. Therefore those 15 are dependency/environment verification blockers, not classified as source assertion failures.

Focused post-fix validation:

- 10/10 provider-neutral withdrawal/migration hardening tests passed.
- Migration manifest checksum validation passed.
- Provider-neutral settlement contract passed.
- Provider-neutral dispute/withdrawal contract passed.
- Non-custodial/provider-refund contracts passed.
- Storage 560 KiB security contracts passed.

## Remaining launch verification

Before final production sign-off, run in a clean environment with network/package access:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build:production
npm run security:ci
npm run db:migrate
npm run providers:configure
npm run release:verify
```

Then verify the actual Render PostgreSQL database with the runtime database validator and perform a real provider sandbox/test transaction.

## Verdict

No additional P0 source-code defect was found after fixing the missed aggregate withdrawal/legacy-dispute inconsistency.

The remaining blocker is **environment verification**, not a known failing assertion: the current audit environment cannot complete dependency installation, so TypeScript, lint, production build, dependency audit, and database integration execution remain unverified here.


## Re-audit findings fixed

A subsequent security re-audit identified three hardening issues that did not invalidate the core payment/withdrawal architecture but were worth correcting before launch:

1. Enterprise worker routes accepted the generic `CRON_SECRET` Vercel-Cron bearer path in addition to the dedicated `ELEMARKET_ENTERPRISE_SYNC_SECRET` HMAC path. This created unnecessary cross-authority access: possession of the general cron credential could authorize enterprise operations. Enterprise routes now require their dedicated HMAC secret; the Vercel Cron bearer transport remains limited to the explicitly scheduled cron routes.
2. Search cursor signing had a predictable development-secret fallback. Shared environments now require `SEARCH_CURSOR_SECRET` or the already-required `BETTER_AUTH_SECRET`; only isolated development/preview may use the development fallback.
3. Homepage ad visitor hashing had the same predictable development-secret fallback. Shared environments now require `BETTER_AUTH_SECRET`; the fallback remains limited to development/preview.

Regression coverage was added in `scripts/deep-security-regression-v3.test.mjs`.

## Re-audit validation

The focused security/provider/migration suite after these fixes passed **55/55**. The repository still contains an incomplete `node_modules` tree in the supplied archive; `pg` and `typescript` entry points are absent. A clean `npm ci --ignore-scripts --prefer-offline` was attempted again and hit the execution environment transport timeout. Therefore full TypeScript, lint, production-build, npm-audit, and live PostgreSQL integration verification remain pending in a clean CI/Render environment.
