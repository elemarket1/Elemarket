# Provider architecture and release gate

## Production blocker: settlement contract

ELEMARKET never holds customer funds. A merchant may withdraw only from a delivered sale after 24 hours without a customer dispute. The installed payment adapter cannot control that delivery-relative settlement window. Production startup and payment initialization therefore reject its missing `deliveryDisputeHold` capability. No configuration flag can grant this capability. The existing `provider_direct_uncontrolled` mode is accepted only for staging tests without customer funds.

A real provider-controlled hold/release contract is required before production. It must cover per-sale delivery notification, dispute freezes, idempotent release, concurrent dispute/release ordering, provider dashboard withdrawals, webhook authentication/replay handling, and reconciliation of unknown outcomes. SQL eligibility alone cannot control money at a provider. Customer-facing release remains blocked until this contract is implemented and verified. Historical escrow tables do not provide custody; active release functions remain disabled.

## Boundaries

Core services call internal contracts; static registries select installed adapters. `src/lib/providers/catalog.mjs` supplies the shared startup allowlist, selected credentials, and payment capabilities. Per-component registries contain explicit imports; environment-controlled module imports and the generic HTTP payment fallback are removed. To add a provider, implement its real protocol, register the explicit factory and configuration/capabilities, and test that protocol. Domain services do not change.

Installed implementations:

| Component | Selection | Adapter / requirements |
|---|---|---|
| Payment | `ELEMARKET_PAYMENT_PROVIDERS` aliases; `ELEMARKET_PAYMENT_<ALIAS>_DRIVER` | `paystack` is the only installed real payment driver. Its alias-specific `_SECRET` is required. `_CHECKOUT_HOSTS` may narrow/override approved hostnames; defaults come from driver metadata. Refunds, idempotent initialization, currencies, methods and merchant-account routing are capabilities. No installed delivery/dispute hold. |
| Storage | `ELEMARKET_STORAGE_PROVIDER=s3` | `STORAGE_ENDPOINT` (public HTTPS origin), `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. Path-style bucket addressing and regional SigV4. |
| Storage compatibility | `ELEMARKET_STORAGE_PROVIDER=r2` | Existing `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`. Only this explicitly selected adapter builds the R2 endpoint. |
| Location | `ELEMARKET_LOCATION_PROVIDER=geoapify` | `GEOAPIFY_API_KEY`. Geocoding/reverse geocoding, Ghana validation, provider-scoped 30-day cache and adapter-owned attribution. Distance and 100 km search logic unchanged. |
| Email | `ELEMARKET_EMAIL_PROVIDER=resend` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`; optional `RESEND_REPLY_TO`. Adapter owns Svix signature parsing; core stores normalized event evidence. Email OTP uses hashed-code challenges and provider-neutral uniqueness. |
| Phone OTP | `ELEMARKET_OTP_PROVIDER=arkesel` | `ARKESEL_API_KEY`, `ARKESEL_OTP_SENDER_ID`; optional `ARKESEL_OTP_MESSAGE`. Message placeholders/sender constraints remain in the adapter. |
| Push | `ELEMARKET_PUSH_PROVIDER=fcm` or `disabled` | Disabled by default. FCM requires `FCM_SERVICE_ACCOUNT_JSON` and public `VITE_FIREBASE_*` browser configuration. Selected browser registry loads the client adapter. Tokens are bound to their transport and account. |
| KYB | `ELEMARKET_KYB_PROVIDER=fylings` or `manual` | Existing manual administrator review by default. Fylings requires `FYLINGS_API_KEY`; optional public HTTPS `FYLINGS_BASE_URL`. Credentials alone do not enable it. |
| Delivery | `ELEMARKET_DELIVERY_PROVIDER=<alias>` | Existing `ELEMARKET_DELIVERY_<ALIAS>_ENDPOINT` and `_SECRET`. This is the documented ELEMARKET JSON quote protocol, **not** a native Bolt/Uber/Yango/other carrier integration. Only the selected alias can resolve. Public HTTPS/DNS checks and redirect rejection apply. Preview quotes are local-preview only. |

Unknown providers fail closed. No Hubtel adapter exists: neither a database seed nor generic JSON HTTP is a Hubtel integration. Implementing it requires verified authentication, initialization, verification, refunds, signature/replay, currency/method, idempotency and settlement contracts. None were invented here.

## Storage security

Private signed reads, tenant/object ownership checks, durable upload intents, conditional immutable PUTs, exact signed content length/type, 560 KiB maximum, no video, magic-byte validation, invalid-object deletion and finalization remain enforced. Storage endpoints are deployment configuration; requests reject private/reserved DNS targets and redirects. S3-compatible services must support these operations. IAM role/session credentials are not implemented.

## Browser security and external services

CSP takes browser origins from the selected adapter configuration, not server API vendor defaults. Server-side payment and geocoding APIs need no browser `connect-src` allowance. Exact HTTPS origin validation rejects wildcards, credentials and injected directives. `ELEMARKET_CSP_CONNECT_SRC` is deployment-only, never request input. Nonces and existing security headers remain. External font loading is removed; CSS uses the system fallback. STUN servers come only from the existing `VITE_STUN_URLS` configuration; an empty list makes no third-party STUN request. Cross-network peer connectivity requires configured ICE infrastructure.

FCM SDK/service worker URLs, OAuth scopes and endpoints remain adapter-local security-sensitive dependencies. SVG namespace and configuration schema URLs are standards/metadata. Lockfile registry/provenance URLs are dependency references. Mobile EAS API origins are explicit deployment configuration. Financing provider identities and approved handoff behavior remain DB configuration; no named financing adapter is implied.

## Database changes

- `0137`: installed payment driver capability metadata; replace the active webhook function's vendor-specific late-refund branch with a pinned-driver capability lookup; generalize location provider constraint; replace email OTP vendor-specific indexes with channel-specific uniqueness. All existing financial locks, immutable bindings, replay evidence and state transitions remain.
- `0138`: bind historical push tokens to their existing transport and require a provider key for new registrations.
- `0139`: require current delivered/completed status in the per-order withdrawal policy, as well as delivery history and the existing 24-hour/dispute checks.

Historical migration bytes/checksums remain intact. Apply these with `npm run db:migrate` before application rollout. Startup verifies migration checksums, active/historical payment bindings and installed refund capability metadata. A provider switch must keep credentials/configuration for unsettled historical transactions; do not reassign an existing payment's driver. Runtime DB roles must not have migration/configuration write privileges.

## Render dependency graph

```text
npm ci
  -> npm run build:production
       -> selected push browser configuration validation
       -> Vite/Nitro build (no runtime provider secrets)
  -> preDeploy: npm run db:migrate
       -> PostgreSQL + immutable migration checksums
  -> node scripts/start.mjs
       -> universal environment / trusted ingress / DB TLS / Redis validation
       -> explicit selected providers + their own credentials
       -> required financial capability gate
       -> DB migrations / pinned provider bindings / capability consistency
       -> Nitro server -> health readiness
```

Render is not a provider selector. No deployment credentials were added to make startup pass. `production` is intentionally blocked on the unavailable financial capability. Build success and fixture tests are not live-provider certification.

## Required live verification

Before launch, use approved sandbox accounts to verify the installed APIs and the new settlement contract. The local emulator catalog was inspected: AWS S3 and Resend are present, but the current application's HTTPS/public-network policy cannot point storage at the local HTTP emulator, and the Resend adapter has no endpoint override. FCM messaging, Geoapify, Arkesel, Fylings and Paystack are absent from that catalog. No security bypass or fabricated integration was added. Real upload/signature behavior, carrier contracts, operational delivery, provider account configuration and Render deployment remain external verification requirements.
