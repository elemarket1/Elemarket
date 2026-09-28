#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from 'node:crypto';
const jobs = {
  'expire-payments': { method: 'GET', path: '/api/internal/expire-payment-orders', secret: 'CRON_SECRET' },
  'brand-integration': { method: 'POST', path: '/api/internal/brand-integration-worker', secret: 'ELEMARKET_ENTERPRISE_SYNC_SECRET' },
};
try {
  const job = jobs[process.argv[2]];
  if (!job) throw new Error('Select expire-payments or brand-integration');
  const origin = new URL(process.env.ELEMARKET_PUBLIC_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('HTTPS job origin required');
  const secret = process.env[job.secret]?.trim();
  if (!secret || secret.length < 32) throw new Error('Job signing secret unavailable');
  const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createHash('sha256').update('').digest('hex');
  const signature = createHmac('sha256',secret).update(`${timestamp}.${nonce}.${job.method}.${job.path}.${bodyHash}`).digest('hex');
  const response = await fetch(new URL(job.path,origin), {
    method:job.method, redirect:'error', signal:AbortSignal.timeout(60000),
    headers:{'x-elemarket-sync-timestamp':timestamp,'x-elemarket-sync-nonce':nonce,'x-elemarket-sync-signature':signature},
  });
  if (!response.ok) throw new Error(`Job returned HTTP ${response.status}`);
  console.log(JSON.stringify({event:'scheduled_job.completed',job:process.argv[2],status:response.status}));
} catch (error) {
  console.error(JSON.stringify({event:'scheduled_job.failed',error:error instanceof Error ? error.message : 'Unknown job failure'}));
  process.exitCode=1;
}
