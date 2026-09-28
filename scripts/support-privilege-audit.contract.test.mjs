import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/0105_support_privilege_audit_hardening.sql', import.meta.url), 'utf8');

test('support DB functions independently enforce customer/admin role boundaries', () => {
  assert.match(migration, /select role into v_role from "user" where id=p_customer_id/i);
  assert.match(migration, /if v_role <> 'customer' then raise exception 'customer role required'/i);
  assert.match(migration, /select role into v_role from "user" where id=p_support_id/i);
  assert.match(migration, /if v_role <> 'admin' then raise exception 'support agent role required'/i);
  assert.match(migration, /current_setting\('app\.user_id', true\) is distinct from p_support_id/i);
});

test('privileged support operations are audited without message bodies', () => {
  assert.match(migration, /support\.agent_message\.sent/i);
  assert.match(migration, /support\.assisted_order\.created/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([^\n]*body/i);
});

test('assisted ordering remains customer-approval and provider-payment based', () => {
  assert.match(migration, /Please review the order details in this chat and approve it before payment/i);
  assert.match(migration, /customer conversation ownership/i);
});
