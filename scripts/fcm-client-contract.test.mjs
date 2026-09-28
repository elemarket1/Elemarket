import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("FCM browser client registers tokens through the authenticated server function", () => {
  const source = read("src/lib/notifications/push/fcm.client.ts");
  assert.match(source, /registerPushToken/);
  assert.match(source, /platform:\s*"web"/);
  assert.match(source, /VITE_FIREBASE_VAPID_KEY/);
  assert.match(source, /serviceWorkerRegistration/);
});

test("FCM service worker supports background notifications and click-through", () => {
  const source = read("public/firebase-messaging-sw.js");
  assert.match(source, /firebase-messaging-compat/);
  assert.match(source, /onBackgroundMessage/);
  assert.match(source, /showNotification/);
  assert.match(source, /notificationclick/);
});

test("Firebase public configuration never uses the server service-account secret", () => {
  const source = read("src/lib/notifications/push/fcm.client.ts");
  assert.doesNotMatch(source, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /VITE_FIREBASE_PROJECT_ID/);
});

test("CSP permits the Firebase browser SDK without exposing broad script origins", () => {
  const source = read("vite.config.ts");
  assert.match(source, /script-src[^\n]*https:\/\/www\.gstatic\.com/);
});

test("production CSP allows the Firebase browser SDK", () => {
  const source = read("src/lib/security/headers.ts");
  assert.match(source, /script-src[^\n]*https:\/\/www\.gstatic\.com/);
});

test("FCM browser config is explicitly validated before token registration", () => {
  const source = read("src/lib/notifications/push/fcm.client.ts");
  assert.match(source, /Firebase web push is not configured/);
  assert.match(source, /VITE_FIREBASE_VAPID_KEY/);
});
