# ELEMARKET Deep Scan — Manual Merchant Approval Fix

## Critical fixes applied

1. **Manual approval is no longer blocked by automated KYB**
   - Starting a review now treats automated KYB as advisory.
   - A missing, unavailable, or failed KYB provider is logged as a warning and does not prevent an authorized administrator from reviewing the application.
   - Approval does not require the business verification check to be `verified`.

2. **Approval + merchant activation are now atomic**
   - Added migration `0144_atomic_manual_merchant_approval.sql`.
   - The database transaction approves the application and activates the merchant together.
   - If activation fails, the approval is rolled back instead of leaving an `approved` application without a merchant workspace.

3. **Migration manifest repaired**
   - `0143_manual_admin_merchant_approval.sql` was missing from `migrations.sha256.json`.
   - Added checksums for migrations `0143` and `0144`.
   - This was a deployment blocker because the migration integrity validator would reject the package.

4. **Provider-neutral settlement startup restored**
   - Removed the production requirement that a payment adapter advertise `deliveryDisputeHold`.
   - Removed the obsolete requirement for `ELEMARKET_SETTLEMENT_MODE` to be `provider_delivery_hold`.
   - ELEMARKET remains non-custodial; provider settlement/refunds stay external and marketplace withdrawal/dispute eligibility remains server-side.

5. **Render/request logging retained and contract tests updated**
   - The package already has request middleware logging method/path/status/duration/request ID without logging cookies or authorization headers.
   - CSP tests were updated to account for the request logger middleware.

6. **Support-chat contracts updated**
   - The floating support widget is the intended in-app chat experience.
   - Order support uses the server-backed conversation and passes the order context through the widget.
   - Obsolete direct-contact environment-variable assertions were removed from the contract test.

## Verification

Focused security/governance/deployment tests after the fixes:

- **26/26 passed** across merchant governance, manual approval, migration integrity, CSP/request middleware, support widget, and startup/provider-boundary tests.

Full suite was also attempted. The remaining failures are execution-environment failures caused by the supplied archive's incomplete `node_modules` (notably missing `pg` and `typescript` entry points) plus integration tests that require external/database fixtures. No full production build/typecheck is claimed from this archive.

## Remaining deployment requirement

Before deploying, run a clean `npm ci` from the repository and then the normal release verification/migration workflow. Migration `0144` must be applied to production.
