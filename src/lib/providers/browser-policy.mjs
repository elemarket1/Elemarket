import { fcmBrowserPolicy } from "../notifications/push/providers/fcm-browser.mjs";
import { selectedProvider } from './catalog.mjs';
/** Only reviewed browser adapters contribute origins. Server-to-server APIs need no browser CSP access. */
const browserAdapters = {
  fcm: fcmBrowserPolicy,
  disabled: { script: [], connect: [], build: [] },
};
/** @param {string} input */
export function httpsOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.port && url.port !== '443') || !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') || /^\d+[.\d]*$/.test(url.hostname)) throw new Error('Invalid configured provider browser origin');
  return url.origin;
}
/** @param {Record<string,string|undefined>} [environment] */
export function browserPolicy(environment = process.env) {
  const selected = selectedProvider('push', environment);
  const policy = browserAdapters[/** @type {keyof typeof browserAdapters} */ (selected.key)];
  if (!policy) throw new Error('Selected push provider has no browser adapter');
  const connect = [...policy.connect];
  for (const origin of (environment.ELEMARKET_CSP_CONNECT_SRC || '').split(/\s+/).filter(Boolean)) connect.push(httpsOrigin(origin));
  if (environment.ELEMARKET_STORAGE_PROVIDER === 's3' && environment.STORAGE_ENDPOINT) connect.push(httpsOrigin(environment.STORAGE_ENDPOINT));
  if (environment.ELEMARKET_STORAGE_PROVIDER === 'r2') {
    const account = environment.CLOUDFLARE_R2_ACCOUNT_ID || '';
    const bucket = environment.CLOUDFLARE_R2_BUCKET || '';
    if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid storage browser origin configuration');
    connect.push(`https://${bucket}.${account}.r2.cloudflarestorage.com`);
  }
  return { script: [...policy.script], connect: [...new Set(connect)], build: policy.build };
}
