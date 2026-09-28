# Render runtime compatibility fix

The deployment was still rejecting Render's native Key Value and Postgres internal URLs because
startup detection depended on an undocumented `RENDER` runtime flag.

Render documents:
- Key Value internal URLs use `redis://red-...:6379`.
- Postgres internal URLs use an internal hostname and support TLS `require` with self-signed certificates.

The startup validator and native Redis support now recognize the documented internal hostname forms:
- Redis: `red-*`
- Postgres: `dpg-*`

Security boundaries remain:
- arbitrary external `redis://` is rejected; use `rediss://`
- non-Render/non-internal Postgres still requires `PG_SSL_MODE=verify-full`
- Render/internal Postgres may use `PG_SSL_MODE=require`
- Redis HTTPS REST still requires `REDIS_HTTP_TOKEN`

Targeted production startup tests: 3 passed, 0 failed.
