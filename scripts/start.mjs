#!/usr/bin/env node
/**
 * Production runtime entrypoint.
 *
 * Database migrations are intentionally NOT executed during application startup.
 * Run `npm run db:migrate` as the deployment/release step before starting the
 * service. This keeps schema changes out of the application availability path.
 */
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const candidates = [
  ".output/server/index.mjs",
  ".vercel/output/functions/__server.func/index.mjs",
  ".vercel/output/server/index.mjs",
];

async function findServerEntry() {
  for (const candidate of candidates) {
    const path = resolve(process.cwd(), candidate);
    try {
      await access(path);
      return path;
    } catch {
      // Try the next generated output layout.
    }
  }
  throw new Error(
    `Nitro server entrypoint not found. Checked: ${candidates.join(", ")}`,
  );
}

function forwardSignal(child, signal) {
  if (!child.killed) child.kill(signal);
}

async function main() {
  console.log(JSON.stringify({
    event: "startup.begin",
    node: process.version,
    pid: process.pid,
    environment: process.env.ELEMARKET_ENV ?? null,
    render: process.env.RENDER === "true",
    timestamp: new Date().toISOString(),
  }));

  const validation = spawnSync(process.execPath, [fileURLToPath(new URL("./validate-startup-env.mjs", import.meta.url)), "--require-shared"], { stdio: "inherit", env: process.env });
  if (validation.error || validation.status !== 0) throw new Error("Startup environment validation failed");
  const databaseValidation = spawnSync(process.execPath, [fileURLToPath(new URL("./validate-runtime-db.mjs", import.meta.url))], { stdio: "inherit", env: process.env });
  if (databaseValidation.error || databaseValidation.status !== 0) throw new Error("Startup database/provider validation failed");
  const entry = await findServerEntry();
  console.log(JSON.stringify({event:"startup.server_start",entry}));

  const server = spawn(process.execPath, [entry], {
    stdio: "inherit",
    env: process.env,
  });

  server.once("spawn", () => {
    console.log(JSON.stringify({ event: "startup.server_spawned", pid: server.pid ?? null, entry }));
  });

  let stopping = false;
  const signals = ["SIGTERM", "SIGINT"];
  for (const signal of signals) {
    process.once(signal, () => {
      stopping = true;
      console.log(JSON.stringify({event:"shutdown.requested",signal}));
      forwardSignal(server, signal);
      setTimeout(() => { if (server.exitCode === null) server.kill("SIGKILL"); }, 25000).unref();
    });
  }

  server.once("error", (err) => {
    console.error("[startup] server failed to start:", err);
    process.exitCode = 1;
  });

  server.once("exit", (code, signal) => {
    if (signal) {
      console.error(`[startup] server terminated by ${signal}`);
      process.exitCode = stopping ? 0 : 1;
    } else {
      process.exitCode = code ?? 0;
    }
  });
}

main().catch((err) => {
  console.error("[startup] failed:", err?.message || err);
  process.exit(1);
});
