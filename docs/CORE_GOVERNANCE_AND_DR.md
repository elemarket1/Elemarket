# ELEMARKET Core Governance / Backup / DR Runbook

## Architecture boundary

External adapters provide capabilities (SMS, email, payment, delivery, KYC, FX, financing). They do not own authorization, merchant ownership, order/payment/refund state transitions, inventory consistency, dispute/refund policy, audit evidence, or access control.

## Already protected in the deployed baseline

- Server-side role authorization and merchant ownership checks.
- Database-enforced order-item and payment-attempt integrity.
- Checkout idempotency and stock reservations.
- PostgreSQL advisory-lock concurrency protection.
- Payment state transitions and webhook replay controls.
- Provider settlement/refund boundaries and payment-provider execution controls.
- Persistent auth rate limiting and fresh-session checks.
- Security headers and API rate limiting.
- Provider-neutral payment/financing adapter boundaries.

## Added by the governance migration

- Append-only `audit_events` evidence.
- Provider-neutral `merchant_verification_checks`.
- Locked merchant application review transitions.
- Merchant ownership remains an explicit `merchant_accounts` binding; approval does not invent missing merchant profile/location data.
- Operational retention policies and a purge function that excludes audit/financial evidence.

## Backup / disaster recovery

Backups and point-in-time recovery are infrastructure responsibilities and must be enabled on the production PostgreSQL provider. The application does not claim a backup exists merely because this document exists.

Required production controls:

1. Enable automated backups/PITR on the managed PostgreSQL provider.
2. Keep backup retention consistent with the organization's legal and operational requirements.
3. Store production secrets outside the repository.
4. Document the database restore procedure and required credentials.
5. Perform a restore drill in an isolated environment before production launch.
6. Verify restored migration/schema version and application health checks.
7. Verify that financial, payment, provider-refund, settlement and audit records survive the restore.
8. Record the restore drill result and timestamp.

## Retention

`purge_operational_retention_data()` only targets ephemeral/operational data explicitly listed in `data_retention_policies`. It must not be used as a generic deletion mechanism for financial, payment, dispute, settlement, merchant ownership or audit evidence.

Retention values are deployment policy defaults, not legal advice. Regulatory, contractual or tax retention requirements override them.
