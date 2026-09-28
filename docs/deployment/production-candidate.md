# Controlled staging deployment

## Settlement contract (release limitation)

Payment collection, merchant settlement and refunds belong to the payment provider. No customer wallet, stored value or ELEMARKET custody is introduced.

The installed Paystack adapter initializes subaccount payments and requests refunds. It has **no delivery-relative settlement hold/release capability**. Neither a SQL eligibility flag nor a provider calendar settlement schedule guarantees delivery plus 24 hours: delivery can happen after a provider settlement. The official [Paystack OpenAPI contract](https://github.com/PaystackOSS/openapi/blob/main/dist/paystack.yaml) exposes transaction/subaccount/refund operations, but the installed integration has no per-order settlement release operation. Do not invent one or replace settlement with platform transfers.

`ELEMARKET_SETTLEMENT_MODE=provider_direct_uncontrolled` explicitly acknowledges this limitation. Other modes fail startup. Merchant/API policy eligibility remains delivery + 24 hours and no dispute, with `deliveryHoldGuaranteed=false` and `providerSettlementControlled=false`. It is an informational marketplace policy, not a representation of held funds or a provider balance. If the business requires an actual hold, commercial provider confirmation and a tested provider-controlled implementation are prerequisites to customer launch. A manual calendar schedule alone is insufficient.

## Runtime

Build `docker build -t elemarket:candidate .`; release with a one-off task running `node scripts/migrate.mjs`, then run `node scripts/start.mjs`. Do not run migrations concurrently with traffic rollout. The migrator verifies checksums and serializes releases. Startup checks all deployed migrations and active provider driver/credential bindings. Use a dedicated migration role and restricted runtime role; grant only required functions/tables. Existing migrations are retained.

Container uses Node 22, UID 1000, port 8080, stdout/stderr logs, external storage, and no writable application data directory. Use a read-only root filesystem and a small writable `/tmp`. Configure ECS `stopTimeout=45`, ALB deregistration delay at least 30 seconds; server drains up to 20 seconds, wrapper enforces a 25-second bound and closes database pools. ALB readiness: `/api/health`; liveness: `/api/live`. Health is not proof of live PSP connectivity.

RDS: PostgreSQL 16+, `PG_SSL_MODE=verify-full`, `PG_SSL_CA_FILE` mounted AWS CA bundle, `DATABASE_URL`. Pool limits apply separately to application and authentication pools: budget **2 × PG_POOL_MAX × task count**, plus release tasks. Default 10 per pool, bounded 1–50, connection timeout 5 seconds, query timeout 15 seconds. Migration queries have no statement timeout. Never use `rejectUnauthorized=false` for non-Render production databases.

Render: Render automatically exposes `RENDER=true`. For a Render-hosted service using Render PostgreSQL, `PG_SSL_MODE=require` is supported for TLS because Render's internal PostgreSQL certificates are self-signed and do not support `verify-full`; the PostgreSQL client therefore uses TLS with certificate verification disabled only for this explicit Render `require` mode. `PG_SSL_MODE=disable` remains rejected, and non-Render shared deployments still require `verify-full`. Prefer the Render internal database URL for same-region services.

## Actual Redis and storage choices

This release supports native Redis/Valkey connections as well as HTTPS Redis REST. On Render, use the internal `redis://...` Key Value URL from the same workspace and region; outside Render, use a TLS `rediss://...` URL. HTTPS REST endpoints require `REDIS_HTTP_TOKEN`. Native Redis rate limiting uses an atomic EVAL script and falls back to PostgreSQL if Redis is unavailable.

Object storage is the existing **Cloudflare R2** adapter (SigV4 region `auto`), with server-side upload intents, ownership, byte/content validation and signed private reads. Configure `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`, bucket CORS and private access. S3 is not interchangeable with this R2 configuration. Retain R2 for staging or implement/test an S3 adapter with regional signing and ECS role credentials before adopting S3. Do not make private documents public via CloudFront.

## Secrets and feature configuration

Inject server secrets from Secrets Manager into the ECS task; never Docker build args, source control, browser variables or logs. Required: database, Redis REST token, `BETTER_AUTH_SECRET` (32+ characters), HTTPS `BETTER_AUTH_URL`/`ELEMARKET_PUBLIC_URL`, `CRON_SECRET`/`ELEMARKET_ENTERPRISE_SYNC_SECRET` (32+ characters), 32-byte merchant encryption key, R2 variables above, `GEOAPIFY_API_KEY`, `ARKESEL_API_KEY`, `ARKESEL_OTP_SENDER_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`.

Declare `ELEMARKET_PAYMENT_PROVIDERS=paystack` (or configured aliases), `ELEMARKET_PAYMENT_<ALIAS>_DRIVER=paystack`, `ELEMARKET_PAYMENT_<ALIAS>_SECRET`, and approved checkout host for aliases. Active DB providers must match. Existing payments pin their owning driver; use a new provider key when migrating drivers. Every Paystack checkout requires the order merchant's active provider subaccount. Bind merchant accounts through the protected operational setup. Configure signed webhook delivery to `/api/payments/webhook`.

FCM is optional: `ELEMARKET_PUSH_PROVIDER=disabled` omits its startup credentials. If enabled, configure `FCM_SERVICE_ACCOUNT_JSON` and public `VITE_FIREBASE_*` identifiers at build time. KYB/financing provider credentials are required when enabling those separate flows; they are not payment startup dependencies. Egress must permit the chosen providers. No live credential check is implied by static configuration validation.

## Scheduled work / EventBridge

Schedule payment expiry at least every minute. EventBridge Scheduler can run this image as a one-off ECS task with command `node scripts/run-scheduled-job.mjs expire-payments` (or `brand-integration`). The runner signs the existing HMAC-authenticated request to the service, with a fresh nonce and body digest. A static API Destination header is insufficient for timestamp/nonce signing. Use `CRON_SECRET`, `x-elemarket-sync-timestamp`, `x-elemarket-sync-nonce`, and `x-elemarket-sync-signature` following `internal-job-auth.server.ts` exactly. Apply the same signer to enterprise/brand workers using their configured secret, HTTP method and path. Store signer secrets in Secrets Manager. Monitor missed runs, backlog and rejected signatures. Never enable unauthenticated cron for convenience.

Refunds with unknown HTTP outcomes remain `needs_attention`; do not automatically retry them. Confirm with the provider and process signed refund webhooks. A durable late-payment case/request is created before outbound refund dispatch; repeated charge webhook delivery resumes an undispatched request. Alert on stranded `requested` or `processing` refunds and reconcile through the protected admin path. Keep financial evidence immutable.

## AWS controls and remaining verification

Provision VPC/private RDS, security groups, ALB HTTPS, WAF, task IAM, CloudWatch log retention/alarms, Secrets Manager rotation, deployment rollback, backups/restore rehearsal and EventBridge signing worker. Startup requires `ELEMARKET_TRUST_PROXY=1`, `ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR=1` and `BETTER_AUTH_IP_HEADER=x-forwarded-for` for a sanitizing ingress (or the Vercel platform contract). Block direct task access. Forwarded IP trust must match the actual ingress: ALB normally appends X-Forwarded-For, so do not claim it overwrites the header. CloudFront behavior must avoid caching authenticated pages, APIs, cookies and private storage responses.

Before customer rollout run real Paystack sandbox initialization, numeric-ID charge webhook, merchant subaccount verification, duplicate/reordered delivery, late success, refund processing/failure, dispute refund and ambiguous timeout reconciliation; exercise Ghana addresses, Arkesel delivery, Resend and R2 with staging credentials. Fixture tests are not live provider verification. Verify SIGTERM with in-flight traffic, target health, RDS failover, distributed rate limits, scheduled jobs, provider refund latency and merchant settlement timing in the actual account contract.
