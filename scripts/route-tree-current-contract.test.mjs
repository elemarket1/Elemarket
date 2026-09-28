import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tree = fs.readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");

const requiredRoutes = [
  "/admin",
  "/orders",
  "/orders/$id",
  "/api/health",
  "/api/brand/integration/webhook",
  "/api/internal/brand-integration-worker",
  "/api/internal/enterprise-webhook-worker",
  "/api/internal/sync-enterprise-catalogs",
  "/api/financing/merchants/$merchantId/health",
];

test("generated TanStack route tree contains all current critical routes", () => {
  for (const route of requiredRoutes) {
    assert.match(tree, new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`));
  }
});

test("generated route tree imports route modules without filesystem extensions", () => {
  assert.doesNotMatch(tree, /from ['"]\.\/routes\/[^'"\n]+\.(?:ts|tsx)['"]/);
});
