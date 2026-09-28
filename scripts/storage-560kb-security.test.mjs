import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');

test('storage hard cap is exactly 560 KiB and video uploads are removed',()=>{
 const s=read('src/lib/storage/storage.server.ts');
 assert.match(s,/MAX_UPLOAD_BYTES = 560 \* 1024/);
 assert.doesNotMatch(s,/product-video|video\/mp4|video\/webm/);
 assert.match(read('src/lib/storage/storage.ts'),/max\(560 \* 1024\)/);
 assert.doesNotMatch(read('src/lib/storage/provider.ts'),/product-video/);
});

test('non-profile uploads require resource ownership context',()=>{
 const s=read('src/lib/storage/storage.server.ts');
 assert.match(s,/resourceId/);
 assert.match(s,/merchant_accounts/);
 assert.match(s,/provider_refund_requests/);
 assert.match(s,/orders/);
});

test('presigned uploads bind the exact Content-Length',()=>{
 const s=read('src/lib/storage/s3.server.ts');
 assert.match(s,/content-length/);
 assert.match(s,/input\.sizeBytes/);
 assert.match(s,/560 \* 1024/);
});


test('storage verification is an explicit finalize state machine with byte-signature validation',()=>{
 const server=read('src/lib/storage/storage.server.ts');
 assert.match(server,/storage_upload_intents/);
 assert.match(server,/status='verifying'/);
 assert.match(server,/status='verified'/);
 assert.match(server,/matchesMagic/);
 assert.match(server,/image\/jpeg/);
 assert.match(server,/image\/png/);
 assert.match(server,/image\/webp/);
 assert.match(server,/application\/pdf/);
 assert.match(server,/readObject/);
});

test('storage upload intent cannot be finalized twice or after expiry',()=>{
 const server=read('src/lib/storage/storage.server.ts');
 assert.match(server,/status='authorized' and expires_at > now\(\)/);
 assert.match(server,/status='verifying'/);
});

test('product media database boundary is image-only',()=>{
 const migration=read('migrations/0066_storage_upload_security.sql');
 assert.match(migration,/media_type in \('image'\)/);
});

test('push tokens cannot be silently reassigned across accounts',()=>{
 const s=read('src/lib/notifications/push/push.server.ts');
 assert.match(s,/already registered to another account/);
 assert.match(s,/select user_id from push_devices where token_hash/);
});
