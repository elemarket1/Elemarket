import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0122_homepage_merchandising.sql", "utf8");
const server = fs.readFileSync("src/routes/homepage.functions.ts", "utf8");
const home = fs.readFileSync("src/routes/index.tsx", "utf8");

test("homepage merchandising has dedicated food and sponsored placements", () => {
  assert.match(migration, /placement in \('sponsored_ads','food_spotlight'\)/);
  assert.match(migration, /homepage_sections/);
  assert.match(server, /section\.section_key==='food_spotlight'/);
  assert.match(home, /HomepageMerchandising/);
});

test("food advertising is constrained to food listings", () => {
  assert.match(migration, /v_product\.listing_type <> 'food'/);
  assert.match(migration, /new\.placement='food_spotlight'/);
  assert.match(migration, /v_product\.stock <= 0/);
});

test("campaign media cannot be an arbitrary external URL", () => {
  assert.match(migration, /external campaign media is not allowed/);
  assert.match(migration, /https\?:\|data:\|javascript:\|\/\//i);
  assert.match(server, /imagePath:z\.string\(\)\.trim\(\)\.max\(500\)/);
});

test("campaigns require merchant ownership and review before activation", () => {
  assert.match(server, /requireMerchantAccessForUserId/);
  assert.match(server, /status:'pending_review'/);
  assert.match(server, /requireAdminForUserId/);
  assert.match(server, /reviewHomepageAdCampaign/);
});

test("campaign schedule, merchant verification, and destination integrity are database enforced", () => {
  assert.match(migration, /validate_homepage_ad_campaign/);
  assert.match(migration, /status <> 'active'/);
  assert.match(migration, /destination_id <> new\.product_id/);
  assert.match(migration, /v_merchant\.verified is not true/);
});

test("ad events are deduplicated server-side", () => {
  assert.match(migration, /homepage_ad_event_dedupe_idx/);
  assert.match(migration, /on conflict \(campaign_id,event_type,session_key\) do nothing/i);
  assert.match(server, /record_homepage_ad_event/);
});

test("homepage sections are bounded and ordered server-side", () => {
  assert.match(migration, /max_items integer not null default 8 check \(max_items between 1 and 20\)/);
  assert.match(server, /order by priority,section_key/);
  assert.match(server, /limit \$1/);
});
