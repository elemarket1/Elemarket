# ELEMARKET v1.99.3

Provider-neutral marketplace platform for commerce, payment-provider settlement/refunds, financing and delivery orchestration. ELEMARKET does not custody customer funds.

## Core

- Product catalogue, variants, cart, checkout and orders
- Merchant, verified-brand and enterprise boundaries
- Provider-neutral payment architecture with deployment-selected adapters
- Provider-managed settlement, refunds and reconciliation controls
- Provider-neutral financing/BNPL integration
- Delivery/logistics adapter boundary
- Authentication, authorization and object-ownership enforcement
- Rate limiting, security headers, startup validation and observability
- PostgreSQL migrations and concurrency-integrity tests

## Payment architecture

The marketplace core does not select or depend on a named payment vendor. Provider adapters are isolated from the core and selected through server-side deployment configuration.

Never expose provider driver module configuration or provider credentials to clients.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

PostgreSQL-backed integration verification:

```bash
RUN_DB_INTEGRATION=1 npm run test:integration:concurrency
```

## Provider configuration

See [provider architecture and deployment requirements](docs/deployment/provider-architecture.md). Production requires a verified provider-controlled delivery/dispute settlement hold; the installed adapter does not implement this capability and production startup therefore fails closed. No live-production readiness is claimed.

## Production boundary

Real payment, financing and delivery providers must be configured and contract-tested before production use. Regulated custody, credit decisions, KYC/KYB and other regulated functions remain with appropriately licensed providers unless ELEMARKET separately obtains the required authorization.

## Scope

Education AI is intentionally outside this repository and will be developed as a separate project.

### Authentication email adapter

Authentication email (password reset and email verification) and email OTP use the same provider-neutral server-side email adapter. Select the installed email adapter explicitly with `ELEMARKET_EMAIL_PROVIDER`; there is no implicit production email provider.

## Resend email OTP

The application supports provider-neutral email OTP through the Resend adapter. Configure these server-only variables in the deployment environment:

- `ELEMARKET_EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=<sending-scoped Resend API key>`
- `RESEND_FROM_EMAIL=ELEMARKET <no-reply@your-verified-domain>`
- `RESEND_REPLY_TO=<optional reply address>`
- `RESEND_WEBHOOK_SECRET=<Resend Svix webhook signing secret>`

The API key and webhook signing secret must never be exposed to client-side code. Configure the Resend webhook endpoint as `/api/email/webhook` and subscribe to the email events required for operations. Use a Resend sending-scoped key restricted to the verified sending domain where possible. Resend supports sending-scoped API keys and domain restrictions. The adapter uses Resend's Email API over HTTPS and an idempotency key per OTP challenge.

### Push notifications (FCM)
ELEMARKET uses Firebase Cloud Messaging through a server-side adapter. Keep the Firebase service-account JSON only in the server secret store; never expose it through `VITE_*` variables or the browser bundle.

- `ELEMARKET_PUSH_PROVIDER=fcm`
- `FCM_SERVICE_ACCOUNT_JSON=<Firebase service-account JSON>`

Mobile clients register their FCM token through the authenticated push-token server functions. The database stores the token server-side and binds it to the authenticated account.

## FCM web push configuration

The server uses `FCM_SERVICE_ACCOUNT_JSON` for Firebase HTTP v1 sending. The browser uses Firebase public configuration values; these are client identifiers, not service-account secrets. Configure:

```text
FCM_SERVICE_ACCOUNT_JSON=<server-only Firebase service account JSON>
VITE_FIREBASE_API_KEY=<Firebase web API key>
VITE_FIREBASE_AUTH_DOMAIN=<Firebase auth domain>
VITE_FIREBASE_PROJECT_ID=<Firebase project id>
VITE_FIREBASE_STORAGE_BUCKET=<Firebase storage bucket>
VITE_FIREBASE_MESSAGING_SENDER_ID=<Firebase messaging sender id>
VITE_FIREBASE_APP_ID=<Firebase web app id>
VITE_FIREBASE_VAPID_KEY=<Firebase Web Push certificate public key>
```

Push registration is authenticated and the FCM token is registered through `/src/routes/push.functions.ts`. Never expose `FCM_SERVICE_ACCOUNT_JSON` or a Firebase private key through a `VITE_` variable.

### Merchant KYB (Fylings adapter)
Merchant onboarding uses a provider-neutral KYB interface. Fylings is the current adapter and can be replaced without changing merchant-domain code.

Server-only deployment variables:

- `ELEMARKET_KYB_PROVIDER=fylings` (use `manual` for the existing administrator review workflow)
- `FYLINGS_API_KEY=<server-only Fylings API key>`
- `FYLINGS_BASE_URL=https://www.fylings.com` (optional; HTTPS required)

The merchant application can submit an optional business registration number. ELEMARKET sends the business name and registration number (when supplied) with country `GH` to Fylings. Fylings returns `verified`, `review`, or `not_found`; ELEMARKET stores a normalized verification result and evidence for admin review. A Fylings result is not itself the final merchant approval: an ELEMARKET administrator must approve the merchant application after email, phone, and business checks are satisfied.

## Location / Geocoding

ELEMARKET uses a provider-neutral `LocationProvider` with Geoapify as the current implementation. Configure `ELEMARKET_LOCATION_PROVIDER=geoapify` and `GEOAPIFY_API_KEY` on the server/Render environment. The API key must never be exposed to browser code. Address lookups are Ghana-filtered and cached for 30 days to reduce free-tier usage. The checkout UI includes Geoapify/OpenStreetMap attribution required for the free plan.

## Enterprise catalog + provider settlement

Enterprise merchants can be switched on by an authorized admin. Enterprise mode sets:

- `tier=enterprise`
- `settlement_model=enterprise_direct`
- `catalog_source=enterprise_api`

Enterprise products are synchronized from the merchant's own HTTPS catalogue API. The connector supports bearer token, API-key, basic authentication, field mapping, upsert-only/snapshot sync, encrypted server-side credentials, sync history, and an optional HMAC webhook trigger.

Enterprise orders remain visible in ELEMARKET's order/payment/audit systems, and the configured payment provider can route the payment to the merchant's provider subaccount. **All orders use provider-managed settlement. ELEMARKET does not custody, release, settle, or pay out customer funds. Refunds are initiated through the configured payment provider and finalized from provider webhooks.**

Required deployment secret for the protected scheduled sync endpoint:

`ELEMARKET_ENTERPRISE_SYNC_SECRET`

The scheduled endpoint is `POST /api/enterprise/catalog/sync` with the `x-elemarket-sync-secret` header. Enterprise catalog credentials require the existing `ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY` encryption key.

For the brand/distributor worker endpoint (`POST /api/internal/brand-integration-worker`), production requires an HMAC proof using `ELEMARKET_ENTERPRISE_SYNC_SECRET`: send `x-elemarket-sync-timestamp` (Unix milliseconds) and `x-elemarket-sync-signature = HMAC-SHA256(secret, "<timestamp>.<method>.<path>")`. The legacy static secret header is accepted only outside production.

Production follow-up: see [release procedure and remaining financial gate](docs/deployment/production-cto-follow-up.md) for explicit provider activation, restricted runtime database roles, outbound security changes, and dependency validation.
