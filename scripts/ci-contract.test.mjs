import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("CI contract: required production checks exist", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const script of ["typecheck", "lint", "test", "build"]) {
    assert.equal(typeof pkg.scripts?.[script], "string", `missing npm script: ${script}`);
  }
  assert.ok(fs.existsSync(path.join(root, ".github/workflows/ci.yml")));
});

test("CI contract: migrations are uniquely numbered and ordered", () => {
  const migrationDir = path.join(root, "migrations");
  const names = fs.readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const numbers = names.map((name) => Number(name.slice(0, 4)));
  assert.equal(new Set(numbers).size, numbers.length, "duplicate migration number");
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.deepEqual(numbers, sorted, "migration files must be lexicographically ordered");
});

test("CI contract: payment and checkout security boundaries are present", () => {
  assert.ok(fs.existsSync(path.join(root, "src/routes/api.payments.webhook.ts")));
  assert.ok(fs.existsSync(path.join(root, "migrations/0012_payment_orchestration.sql")));
  const checkout = read("migrations/0011_checkout_reservations.sql");
  assert.match(checkout, /reservation/i);
  const payment = read("migrations/0012_payment_orchestration.sql");
  assert.match(payment, /webhook|provider|payment/i);
});

test("CI contract: historical unsafe paid-order function is explicitly removed", () => {
  const safety = read("migrations/0004_checkout_safety.sql");
  assert.match(safety, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+place_paid_order/i);
});


test("CI includes a real PostgreSQL concurrency integration job", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /postgres:16/);
  assert.match(workflow, /npm run db:migrate/);
  assert.match(workflow, /npm run test:integration:concurrency/);
  assert.match(workflow, /RUN_DB_INTEGRATION: "1"/);
});

test('runtime container includes the transitive provider-policy metadata and production build validation',()=>{
 const docker=fs.readFileSync('Dockerfile','utf8');
 assert.match(docker,/RUN npm run build:production/);
 assert.match(docker,/COPY[^\n]*src\/lib\/notifications\/push\/providers\/fcm-browser\.mjs/);
 assert.match(docker,/scripts\/runtime-db-policy\.mjs/);
});
