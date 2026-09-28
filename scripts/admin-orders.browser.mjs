import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { chromium } from "playwright";
import { createPaymentFixture } from "./helpers/payment-fixture.mjs";
const origin = new URL(process.env.ELEMARKET_BROWSER_ORIGIN ?? "http://localhost:8080");
const database = new URL(process.env.ELEMARKET_INTEGRATION_DATABASE_URL);
assert.ok(
  ["localhost", "127.0.0.1"].includes(origin.hostname) &&
    ["localhost", "127.0.0.1"].includes(database.hostname),
);
assert.equal(process.env.ELEMARKET_ALLOW_SYNTHETIC_SEED, "1");
assert.ok(!["production", "staging"].includes(process.env.ELEMARKET_ENV));
const launch = process.argv.includes("--launch");
assert.ok(launch || process.env.ELEMARKET_BROWSER_CDP);
const pool = new Pool({ connectionString: database.href }),
  query = async (s, p) => (await pool.query(s, p)).rows;
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=/g, ""))
    bits += alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", bytes).update(counter).digest(),
    offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
let browser, page, timer;
try {
  const work = async () => {
    browser = launch
      ? await chromium.launch({ headless: true })
      : await chromium.connectOverCDP(process.env.ELEMARKET_BROWSER_CDP);
    const context = launch ? await browser.newContext() : browser.contexts()[0];
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    const post = async (path, data) => {
      const response = await context.request.post(new URL("/api/auth" + path, origin).href, {
        headers: { origin: origin.origin },
        data,
        timeout: 10000,
        maxRedirects: 0,
      });
      assert.equal(response.status(), 200, `Auth ${path}`);
      return response.json();
    };
    const password = randomBytes(24).toString("base64url"),
      email = `admin_ui_${randomBytes(8).toString("hex")}@integration.test`;
    const signup = await post("/sign-up/email", {
      email,
      password,
      name: "Synthetic Operations Admin",
    });
    await query('update "user" set role=\'admin\',"emailVerified"=true where id=$1', [
      signup.user.id,
    ]);
    await post("/sign-in/email", { email, password });
    const ids = await createPaymentFixture(query);
    await query(
      'insert into account(id,"accountId","providerId","userId",password,"updatedAt") values($1,$1,\'credential\',$1,$2,now())',
      [ids.user, await hashPassword(password)],
    );
    await page.goto(new URL("/admin/orders/" + ids.order, origin).href);
    await page.getByRole("alert").filter({ hasText: "verified MFA session" }).waitFor();
    const enrollment = await post("/two-factor/enable", { password });
    await post("/two-factor/verify-totp", {
      code: totp(new URL(enrollment.totpURI).searchParams.get("secret")),
      trustDevice: false,
    });
    await page.goto(new URL("/admin/orders", origin).href);
    await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
    await page.getByLabel("Exact identifier / reference").fill(ids.order);
    await page.getByRole("button", { name: "Search orders", exact: true }).click();
    await page.locator("tbody tr").nth(1).waitFor({ state: "detached" });
    await page.getByRole("cell", { name: ids.order, exact: true }).waitFor();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("heading", { name: "Order " + ids.order, exact: true }).waitFor();
    await page.getByRole("button", { name: "Customer", exact: true }).click();
    await page.getByText(ids.user, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Merchant", exact: true }).click();
    await page.getByText("Integration Merchant", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Items", exact: true }).click();
    await page.getByRole("cell", { name: "IT-SKU", exact: true }).waitFor();
    await page.getByRole("button", { name: "Support", exact: true }).click();
    await page.getByRole("button", { name: "Open customer conversation", exact: true }).click();
    await page.getByRole("heading", { name: "Order support", exact: true }).waitFor();
    await page.getByLabel("Support message").fill("Customer visible operations reply");
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await page.getByText("Customer visible operations reply", { exact: true }).waitFor();
    const supportVisibility = page.getByLabel("Message visibility");
    const supportMessage = page.getByTestId("admin-support-message");
    const supportSubmit = page.getByTestId("admin-support-submit");
    await supportVisibility.selectOption("note");
    await assert.doesNotReject(async () => supportMessage.fill("STAFF ONLY browser regression note"));
    assert.equal(await supportMessage.inputValue(), "STAFF ONLY browser regression note");
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="admin-support-submit"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    assert.equal(await supportSubmit.isEnabled(), true);
    await supportSubmit.click();
    await page.getByText("STAFF ONLY browser regression note", { exact: true }).waitFor();
    if (process.env.ELEMARKET_BROWSER_SCREENSHOT)
      await page.screenshot({ path: process.env.ELEMARKET_BROWSER_SCREENSHOT, fullPage: true });
    await post("/sign-out", {});
    await post("/sign-in/email", { email: ids.user + "@integration.test", password });
    await page.goto(new URL("/support?orderId=" + encodeURIComponent(ids.order), origin).href);
    await page.getByText("Customer visible operations reply", { exact: true }).first().waitFor();
    assert.equal(
      await page.getByText("STAFF ONLY browser regression note", { exact: true }).count(),
      0,
    );
    await page.goto(new URL("/admin/orders/" + ids.order, origin).href);
    await page.getByRole("alert").filter({ hasText: "administrator access" }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Order " + ids.order, exact: true }).count(),
      0,
    );
    await post("/sign-out", {});
    console.log(
      "PASS: admin password-only denied; real TOTP enables exact search/detail/items/customer/merchant/support; public reply visible; internal note private; customer admin access denied",
    );
  };
  await Promise.race([
    work(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Admin browser regression timed out")), 120000);
    }),
  ]);
} finally {
  clearTimeout(timer);
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await pool.end();
}
