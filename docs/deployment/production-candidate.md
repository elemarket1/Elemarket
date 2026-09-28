# Controlled staging deployment

## Settlement contract (release limitation)

Payment collection, merchant settlement and refunds belong to the payment provider. No customer wallet, stored value or ELEMARKET custody is introduced.

The installed Paystack adapter initializes subaccount payments and requests refunds. It has **no delivery-relative settlement hold/release capability**. Neither a SQL eligibility flag nor a provider calendar settlement schedule guarantees delivery plus 24 hours: delivery can happen after a provider settlement. The official [Paystack OpenAPI contract](https://github.com/PaystackOSS/openapi/blob/main/dist/paystack.yaml) exposes transaction/subaccount/refund operations, but the installed integration has no per-order settlement release operation. Do not invent one or replace settlement with platform transfers.

Production uses provider-neutral payment adapters. Provider capabilities describe only what each adapter actually implements (initialization, verification, refunds, merchant-account support, currencies and methods); no provider is required to control ELEMARKET’s delivery-relative settlement window. The delivery + 24 hours and no-dispute eligibility rule remains server-side for merchant withdrawals, and ELEMARKET does not hold customer funds or implement local escrow.

## Runtime

Build `docker build -t elemarket:candidate .`; release with a one-off task running `node scripts/migrate.mjs`, then run `node scripts/start.mjs`. Do not run migrations concurrently with traffic rollout. The migrator verifies checksums and serializes releases. Startup checks all deployed migrations and active provider driver/credential bindings. Use a dedicated migration role and restricted runtime role; grant only required functions/tables. Existing migrations are retained.

Container uses Node 22, UID 1000, port 8080, stdout/stderr logs, external storage, and no writable application data directory. Use a read-only root filesystem and a small writable `/tmp`. Configure ECS `stopTimeout=45`, ALB deregistration delay at least 30 seconds; server drains up to 20 seconds, wrapper enforces a 25-second bound and closes database pools. ALB readiness: `/api/health`; liveness: `/api/live`. Health is not proof of live PSP connectivity.

RDS: PostgreSQL 16+, `PG_SSL_MODE=verify-full`, `PG_SSL_CA_FILE` mounted AWS CA bundle, `DATABASE_URL`. Pool limits apply separately to application and authentication pools: budget **2 × PG_POOL_MAX × task count**, plus release tasks. Default 10 per pool, bounded 1–50, connection timeout 5 seconds, query timeout 15 seconds. Migration queries have no statement timeout. Never use `rejectUnauthorized=false` for non-Render production databases.

Render: Render automatically exposes `RENDER=true`. For a Render-hosted service using Render PostgreSQL, `PG_SSL_MODE=require` is supported for TLS because Render's internal PostgreSQL certificates are self-signed and do not support `verify-full`; the PostgreSQL client therefore uses TLS with certificate verification disabled only for this explicit Render `require` mode. `PG_SSL_MODE=disable` remains rejected, and non-Render shared deployments still require `verify-full`. Prefer the Render internal database URL for same-region services.

## Actual Redis and storage choices

This release supports native Redis/Valkey connections as well as HTTPS Redis REST. On Render, use the internal `redis://...` Key Value URL from the same workspace and region; outside Render, use a TLS `rediss://...` URL. HTTPS REST endpoints require `REDIS_HTTP_TOKEN`. Native Redis rate limiting uses an atomic EVAL script and falls back to PostgreSQL if Redis is unavailable.

Object storage supports configured S3-compatible HTTPS endpoints using `ELEMARKET_STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, and `STORAGE_SECRET_ACCESS_KEY`. The endpoint is an origin; the adapter adds the bucket path and signs with the configured region. The legacy R2 adapter remains explicitly selectable and alone requires `CLOUDFLARE_R2_*`. Private objects, upload intents, ownership, signed headers, conditional writes and byte/content verification remain mandatory. This implementation uses access keys; workload role/session credentials are not implemented.

Only the selected email, location, OTP, push and KYB adapters require credentials. See [the configuration matrix](provider-architecture.md). Push defaults to `disabled`, KYB defaults to the existing `manual` review flow. Other component selections must be explicit. Credentials alone never enable a provider. Payment aliases map to statically installed drivers and capabilities; generic HTTP is not a payment-provider integration. The configured delivery endpoint must implement the existing ELEMARKET quote protocol; named carrier integrations are not implied.

## Scheduled work / EventBridge

Schedule payment expiry at least every minute. EventBridge Scheduler can run this image as a one-off ECS task with command `node scripts/run-scheduled-job.mjs expire-payments` (or `brand-integration`). The runner signs the existing HMAC-authenticated request to the service, with a fresh nonce and body digest. A static API Destination header is insufficient for timestamp/nonce signing. Use `CRON_SECRET`, `x-elemarket-sync-timestamp`, `x-elemarket-sync-nonce`, and `x-elemarket-sync-signature` following `internal-job-auth.server.ts` exactly. Apply the same signer to enterprise/brand workers using their configured secret, HTTP method and path. Store signer secrets in Secrets Manager. Monitor missed runs, backlog and rejected signatures. Never enable unauthenticated cron for convenience.

Refunds with unknown HTTP outcomes remain `needs_attention`; do not automatically retry them. Confirm with the provider and process signed refund webhooks. A durable late-payment case/request is created before outbound refund dispatch; repeated charge webhook delivery resumes an undispatched request. Alert on stranded `requested` or `processing` refunds and reconcile through the protected admin path. Keep financial evidence immutable.

## Optional AWS deployment controls and remaining verification

These infrastructure choices apply only when AWS is selected. Other hosting platforms use their own equivalents.

Provision VPC/private RDS, security groups, ALB HTTPS, WAF, task IAM, CloudWatch log retention/alarms, Secrets Manager rotation, deployment rollback, backups/restore rehearsal and EventBridge signing worker. Startup requires `ELEMARKET_TRUST_PROXY=1`, `ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR=1` and `BETTER_AUTH_IP_HEADER=x-forwarded-for` for a sanitizing ingress (or the Vercel platform contract). Block direct task access. Forwarded IP trust must match the actual ingress: ALB normally appends X-Forwarded-For, so do not claim it overwrites the header. CloudFront behavior must avoid caching authenticated pages, APIs, cookies and private storage responses.

Before customer rollout run real Paystack sandbox initialization, numeric-ID charge webhook, merchant subaccount verification, duplicate/reordered delivery, late success, refund processing/failure, dispute refund and ambiguous timeout reconciliation; exercise Ghana addresses, Arkesel delivery, Resend and R2 with staging credentials. Fixture tests are not live provider verification. Verify SIGTERM with in-flight traffic, target health, RDS failover, distributed rate limits, scheduled jobs, provider refund latency and merchant settlement timing in the actual account contract.
