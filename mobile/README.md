# ELEMARKET Mobile

Native Expo/React Native client for ELEMARKET. It uses the same Better Auth identity as the web application.

## Authentication security
- Better Auth Bearer plugin on the server.
- Native sign-in reads `set-auth-token` from the auth response.
- Long-lived credential is stored only in `expo-secure-store` with device-only keychain accessibility.
- API requests send `Authorization: Bearer <token>`.
- Sign-out calls the server and removes the local token.
- No token is stored in AsyncStorage, localStorage, SQLite, logs, URLs, or analytics.
- The server resolves the user from the bearer session; the mobile client never sends a trusted user ID for authorization.

## Run
1. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to the ELEMARKET API origin. Never commit the production domain as source code; Expo embeds this public value at build time.
2. `npm ci`
3. `npx expo start`
4. Build with EAS or native `expo run:android` / `expo run:ios`.

The mobile client includes secure authentication, marketplace browsing/search, profile management, cart, live delivery quotes, server-authoritative checkout, and an in-app WebView payment experience. Payment status is verified by the ELEMARKET server/provider before an order is presented as paid. The mobile client never implements authoritative pricing, order state, or payment verification locally.

## Reproducible SDK dependencies

Use Node22 and `npm ci` with the committed mobile lockfile. Package versions are aligned to the Expo55 compatibility manifest. Check them with `node node_modules/expo/bin/cli install --check`, then run `npm run typecheck`. The scoped xcode/uuid override retains the existing v4 API while applying its bounds-check security fix. Remaining dependency advisories and native release validation are recorded in the production follow-up report. The public API origin is a build setting and must point to the deployed HTTPS backend; credentials must never be placed in public variables.
