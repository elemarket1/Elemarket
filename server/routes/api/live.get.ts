export default () => Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
