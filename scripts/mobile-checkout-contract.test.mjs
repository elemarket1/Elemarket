import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('mobile checkout/payment endpoints are real server-authoritative routes', () => {
  const checkout = read('src/routes/api.mobile.checkout.ts');
  const intent = read('src/routes/api.mobile.payment-intent.ts');
  const status = read('src/routes/api.mobile.payment-status.ts');
  const delivery = read('src/routes/api.mobile.delivery-quote.ts');
  const tree = read('src/routeTree.gen.ts');
  for (const route of [checkout, intent, status, delivery]) {
    assert.match(route, /auth\.api\.getSession/);
    assert.match(route, /readBodyWithLimit/);
    assert.match(route, /z\.object/);
  }
  assert.match(checkout, /createPendingCheckoutServer/);
  assert.match(intent, /createExternalPaymentIntent/);
  assert.match(status, /requireCustomerPayment/);
  assert.match(delivery, /requestDeliveryQuoteServer/);
  for (const path of ['/api/mobile/checkout','/api/mobile/delivery-quote','/api/mobile/payment-intent','/api/mobile/payment-status']) {
    assert.match(tree, new RegExp(path.replaceAll('/', '\\/')));
  }
});

test('mobile payment UI keeps provider checkout inside the app and polls server status', () => {
  const payment = read('mobile/app/payment.tsx');
  const checkout = read('mobile/app/checkout.tsx');
  assert.match(payment, /WebView/);
  assert.match(payment, /\/api\/mobile\/payment-status/);
  assert.match(checkout, /\/api\/mobile\/checkout/);
  assert.match(checkout, /\/api\/mobile\/payment-intent/);
  assert.match(checkout, /Crypto\.digestStringAsync/);
});
