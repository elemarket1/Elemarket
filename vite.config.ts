import { browserPolicy } from "./src/lib/providers/browser-policy.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

function securityHeadersPlugin(): Plugin {
  return {
    name: "elemarket:security-headers",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const headers = {
          "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' ${browserPolicy().script.join(" ")}; connect-src 'self' https: ws: wss:`,
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Permitted-Cross-Domain-Policies": "none",
          "Origin-Agent-Cluster": "?1",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
          "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        };
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
        next();
      });
    },
  };
}

function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "elemarket:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") await mod.ensureDbReady();
      } catch (err) {
        console.error("[elemarket] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    securityHeadersPlugin(),
    pgliteBootstrapPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [nitro({ preset: "node-server", serverDir: "./server", entry: "./server/entry.ts" })]
      : []),
    viteReact(),
  ],
}));
