import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin entry uses a dedicated /admin route and server-side role check", () => {
  const route = read("src/routes/admin/index.tsx");
  const access = read("src/routes/admin/access.functions.ts");
  assert.match(route, /createFileRoute\("\/admin\/"\)/);
  const routeTree = read("src/routeTree.gen.ts");
  assert.match(routeTree, /AdminIndexRouteImport.*routes\/admin\/index/);
  assert.match(routeTree, /['"]\/admin\/?['"]:\s+typeof AdminIndexRoute/);
  assert.match(access, /getSessionUser/);
  assert.match(access, /row\?\.role === "admin"/);
  assert.doesNotMatch(route, /requireAdminForUserId|authorization\.server|@\/lib\/db/);
});

test("admin dashboard redirects through the dedicated admin entry point", () => {
  const dashboard = read("src/routes/admin/dashboard.tsx");
  assert.match(dashboard, /getAdminAccessState/);
  assert.match(dashboard, /redirect\(\{ to: "\/admin" \}\)/);
});

test("admin entry is excluded from search indexing", () => {
  const route = read("src/routes/admin/index.tsx");
  assert.match(route, /noindex,nofollow,noarchive/);
});
