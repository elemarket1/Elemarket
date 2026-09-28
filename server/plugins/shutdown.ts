import { definePlugin } from "nitro";
import type { Pool } from "pg";

export default definePlugin((app) => {
  app.hooks.hook("close", async () => {
    const state = globalThis as typeof globalThis & { __elemarketPools__?: Set<Pool> };
    await Promise.all([...state.__elemarketPools__ ?? []].map((pool) => pool.end()));
    console.log(JSON.stringify({ event: "shutdown.database_pools_closed" }));
  });
});
