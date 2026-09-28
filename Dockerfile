FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
# Public browser configuration only; server/provider credentials are runtime secrets.
ARG ELEMARKET_PUSH_PROVIDER=disabled
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_VAPID_KEY
COPY . .
RUN npm run build:production

FROM node:22.23.3-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 SERVER_SHUTDOWN_TIMEOUT=20
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /app/.output ./.output
COPY --chown=node:node scripts/start.mjs scripts/validate-startup-env.mjs scripts/validate-runtime-db.mjs scripts/runtime-db-policy.mjs scripts/postgres-config.mjs scripts/migrate.mjs scripts/configure-payment-providers.mjs scripts/migration-plan.mjs scripts/run-scheduled-job.mjs ./scripts/
COPY --chown=node:node src/lib/providers ./src/lib/providers
COPY --chown=node:node src/lib/notifications/push/providers/fcm-browser.mjs ./src/lib/notifications/push/providers/
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node migrations.sha256.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "scripts/start.mjs"]
