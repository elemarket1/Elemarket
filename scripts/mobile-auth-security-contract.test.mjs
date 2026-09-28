import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("mobile auth uses Better Auth bearer plugin and server middleware accepts bearer sessions",()=>{
  const server=read("src/lib/auth/server.ts");
  const middleware=read("src/lib/auth/middleware.ts");
  assert.match(server,/import \{ bearer \} from "better-auth\/plugins"/);
  assert.match(server,/plugins:\s*\[\s*bearer\(\),[\s\S]*twoFactor\({[\s\S]*tanstackStartCookies\(\),\s*\],/);
  assert.match(middleware,/authorization/);
  assert.match(middleware,/Bearer\\s/);
  assert.match(middleware,/requireUserId\(bearerToken\)/);
});

test("mobile credential is stored in SecureStore only",()=>{
  const auth=read("mobile/src/auth.ts");
  assert.match(auth,/expo-secure-store/);
  assert.match(auth,/WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.doesNotMatch(auth,/AsyncStorage|localStorage|sessionStorage/);
  assert.match(auth,/authorization/i);
});

test("mobile profile route derives identity from Better Auth session",()=>{
  const route=read("src/routes/api.mobile.profile.ts");
  assert.match(route,/auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(route,/current\.user\.id/);
  assert.doesNotMatch(route,/body.*userId|userId.*body/);
});


test("mobile transport is HTTPS-only and the API origin cannot be attacker-selected",()=>{
  const auth=read("mobile/src/auth.ts");
  assert.match(auth,/ELEMARKET mobile API must use HTTPS/);
  assert.match(auth,/PRODUCTION_API_HOSTS|assertSecureBaseUrl|EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(auth,/elevoratrading\.com/);
  assert.match(auth,/Invalid API path/);
  assert.match(auth,/REQUEST_TIMEOUT_MS/);
});

test("native platform configuration disables cleartext transport",()=>{
  const app=JSON.parse(read("mobile/app.json"));
  assert.equal(app.expo.android.usesCleartextTraffic,false);
  assert.equal(app.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,false);
});

test("production auth has explicit bounded session and password policy",()=>{
  const server=read("src/lib/auth/server.ts");
  assert.match(server,/minPasswordLength: 12/);
  assert.match(server,/maxPasswordLength: 128/);
  assert.match(server,/expiresIn: 60 \* 60 \* 24 \* 7/);
  assert.match(server,/freshAge: 60 \* 5/);
});


test("private mobile API routes have subject-scoped abuse limits",()=>{
  const me=read("src/routes/api.mobile.me.ts");
  const profile=read("src/routes/api.mobile.profile.ts");
  assert.match(me,/enforceRateLimit\("mobile-me"/);
  assert.match(me,/subject: current\.user\.id/);
  assert.match(profile,/enforceRateLimit\("mobile-profile-write"/);
  assert.match(profile,/subject: current\.user\.id/);
});
