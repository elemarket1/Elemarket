import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// This mutation test is deliberately limited to disposable local fixtures.
const origin = new URL(process.env.ELEMARKET_BROWSER_ORIGIN ?? "http://localhost:8080");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname), "Only local QA is supported");
const launch = process.argv.includes("--launch");
assert.ok(
  process.env.ELEMARKET_BROWSER_CDP || launch,
  "Use the existing shared browser CDP, or explicitly launch in CI",
);
assert.ok(process.env.ELEMARKET_BROWSER_FIXTURE, "A synthetic browser fixture is required");

const TEST_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 3_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 15_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function gotoApp(pathname) {
  const url = new URL(pathname, origin).href;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      // A document navigation can return a null response during a client-side
      // transition. The URL and DOM are the authoritative signals for this
      // regression, so do not require a particular HTTP response object.
      await page.waitForURL(url, { timeout: NAVIGATION_TIMEOUT_MS });
      if (page.url() !== url) throw new Error(`Unexpected browser URL: ${page.url()}`);
      return response;
    } catch (error) {
      lastError = error;
      const message = String(error);
      const retryable = message.includes("net::ERR_ABORTED") || message.includes("ERR_ABORTED");
      if (!retryable || attempt === 2) throw error;
      // Give TanStack Start/Vite a short opportunity to finish a cancelled
      // document/client transition before retrying the exact same URL.
      await page.waitForTimeout(250);
    }
  }
  throw lastError ?? new Error(`Navigation failed for ${url}`);
}

async function reloadApp() {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      const retryable = message.includes("net::ERR_ABORTED") || message.includes("ERR_ABORTED");
      if (!retryable || attempt === 2) throw error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError ?? new Error("Browser reload failed");
}

const fixture = JSON.parse(await readFile(process.env.ELEMARKET_BROWSER_FIXTURE, "utf8"));
assert.ok(fixture.email.endsWith("@integration.test"));

let browser;
let context;
let page;
let testTimer;

async function boundedCleanup(label, operation) {
  let timer;
  try {
    await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(`${label} cleanup`, CLEANUP_TIMEOUT_MS)), CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error(`[browser-regression] ${label} cleanup failed:`, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  browser = launch
    ? await chromium.launch({ headless: true })
    : await chromium.connectOverCDP(process.env.ELEMARKET_BROWSER_CDP);
  context = launch ? await browser.newContext() : browser.contexts()[0];
  assert.ok(context, "A browser context is required");
  page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

  // BrowserContext.request shares the real browser cookie jar but survives
  // document reloads/HMR. Keep origin/CSRF validation and real auth endpoints.
  const login = await context.request.post(new URL("/api/auth/sign-in/email", origin).href, {
    headers: { origin: origin.origin },
    data: { email: fixture.email, password: fixture.password },
    timeout: AUTH_REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
  });
  assert.equal(login.status(), 200, "Real authentication must succeed");
  await login.dispose();

  const detail = `/orders/${fixture.orderId}`;
  await gotoApp(detail);
  await page.getByRole("heading", { name: fixture.orderId, exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel order", exact: true }).waitFor();
  await reloadApp();
  await page.getByRole("heading", { name: fixture.orderId, exact: true }).waitFor();
  await page.getByRole("link", { name: "← My orders" }).click();
  await page.getByRole("heading", { name: "My orders", exact: true }).waitFor();
  await page.locator(`a[href="${detail}"]`).click();
  await page.getByRole("heading", { name: fixture.orderId, exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await page
    .getByText("Order cancelled. No payment refund was needed.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Cancel order", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Cancel order", exact: true }).count(), 0);
  await gotoApp(`/orders/${fixture.paidOrderId}`);
  await page.getByRole("heading", { name: fixture.paidOrderId, exact: true }).waitFor();
  await page
    .getByPlaceholder("Describe the problem with this order")
    .fill("Synthetic regression: item did not arrive as described.");
  await page.getByRole("button", { name: "Open dispute", exact: true }).click();
  await page.getByText("Your dispute has been opened.", { exact: true }).waitFor();
  await gotoApp(`/orders/${fixture.foreignOrderId}`);
  await page.getByRole("alert").filter({ hasText: "We couldn't load this order." }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: fixture.foreignOrderId, exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Cancel order", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Cancel order", exact: true }).count(), 0);
  const signedOut = await context.request.post(new URL("/api/auth/sign-out", origin).href, {
    headers: { origin: origin.origin },
    data: {},
    timeout: AUTH_REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
  });
  assert.equal(signedOut.status(), 200, "Real sign-out must succeed");
  await signedOut.dispose();
  await gotoApp(detail);
  await page.getByRole("alert").filter({ hasText: "We couldn't load this order." }).waitFor();
  assert.equal(await page.getByRole("heading", { name: fixture.orderId, exact: true }).count(), 0);
  console.log(
    "PASS: real login, direct detail, reload, list navigation, cancellation, dispute, cross-account denial and signed-out denial",
  );
}

try {
  await Promise.race([
    run(),
    new Promise((_, reject) => {
      testTimer = setTimeout(() => reject(timeoutError("Browser authorization regression", TEST_TIMEOUT_MS)), TEST_TIMEOUT_MS);
    }),
  ]);
} finally {
  clearTimeout(testTimer);
  // Close our page, then close CI's owned browser or disconnect our CDP client.
  // Never close the shared default BrowserContext used by the preview.
  await boundedCleanup("page", async () => page?.close({ runBeforeUnload: false }));
  await boundedCleanup("browser", async () => browser?.close());
}
