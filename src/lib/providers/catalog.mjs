/** Deployment-owned allowlist. Adding a driver requires reviewed code, never an environment module path. */
export const paymentDrivers = Object.freeze({
  paystack: Object.freeze({
    required: ['SECRET'], checkoutHosts: ['checkout.paystack.com'],
    capabilities: Object.freeze({ initialize: true, checkout: true, verify: true, webhook: true, refund: true,
      idempotentInitialization: true, merchantAccount: true,
      currencies: ['GHS'], methods: ['mobile_money', 'card', 'bank_transfer'] }),
  }),
});
/** @type {Record<string, {selection: string, optional?: string, drivers: Record<string, {required: string[], capabilities: string[]}>}>} */
export const components = {
  search: { selection: 'ELEMARKET_SEARCH_PROVIDER', optional: 'postgres', drivers: { postgres: { required: [], capabilities: ['search'] }, typesense: { required: ['TYPESENSE_HOST','TYPESENSE_SEARCH_KEY'], capabilities: ['search'] } } },
  storage: { selection: 'ELEMARKET_STORAGE_PROVIDER', drivers: {
    s3: { required: ['STORAGE_ENDPOINT','STORAGE_REGION','STORAGE_BUCKET','STORAGE_ACCESS_KEY_ID','STORAGE_SECRET_ACCESS_KEY'], capabilities: ['privateObjects','signedUrls','conditionalUpload','delete','boundedRead'] },
    r2: { required: ['CLOUDFLARE_R2_ACCOUNT_ID','CLOUDFLARE_R2_ACCESS_KEY_ID','CLOUDFLARE_R2_SECRET_ACCESS_KEY','CLOUDFLARE_R2_BUCKET'], capabilities: ['privateObjects','signedUrls','conditionalUpload','delete','boundedRead'] },
  }},
  location: { selection: 'ELEMARKET_LOCATION_PROVIDER', drivers: { geoapify: { required: ['GEOAPIFY_API_KEY'], capabilities: ['geocode','reverseGeocode'] } } },
  email: { selection: 'ELEMARKET_EMAIL_PROVIDER', drivers: { resend: { required: ['RESEND_API_KEY','RESEND_FROM_EMAIL','RESEND_WEBHOOK_SECRET'], capabilities: ['send','authenticatedWebhook'] } } },
  otp: { selection: 'ELEMARKET_OTP_PROVIDER', drivers: { arkesel: { required: ['ARKESEL_API_KEY','ARKESEL_OTP_SENDER_ID'], capabilities: ['send','verify'] } } },
  push: { selection: 'ELEMARKET_PUSH_PROVIDER', optional: 'disabled', drivers: { fcm: { required: ['FCM_SERVICE_ACCOUNT_JSON'], capabilities: ['sendToToken'] }, disabled: {required: [], capabilities: []} } },
  kyb: { selection: 'ELEMARKET_KYB_PROVIDER', optional: 'manual', drivers: { fylings: { required: ['FYLINGS_API_KEY'], capabilities: ['verifyBusiness'] }, manual: {required: [], capabilities: []} } },
};
/** @param {string} component @param {Record<string,string|undefined>} [environment] */
export function selectedProvider(component, environment = process.env) {
  const spec = components[component];
  if (!spec) throw new Error(`Unknown provider component: ${component}`);
  const key = (environment[spec.selection]?.trim() || spec.optional || '').toLowerCase();
  if (!key) throw new Error(`${component}: missing configuration ${spec.selection}`);
  if (!/^[a-z0-9_-]{2,64}$/.test(key)) throw new Error(`${component}: invalid provider identifier`);
  if (!Object.hasOwn(spec.drivers, key)) throw new Error(`${component}: selected provider '${key}' is unavailable`);
  return { key, ...spec.drivers[key] };
}
/** @param {string} key */
export function paymentPrefix(key) {
  if (!/^[a-z0-9_-]{2,64}$/.test(key)) throw new Error('payment: invalid provider key');
  return `ELEMARKET_PAYMENT_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}
/** @param {string} driver */
export function paymentDriver(driver) {
  if (!/^[a-z0-9_-]{2,64}$/.test(driver)) throw new Error('payment: invalid driver identifier');
  if (!Object.hasOwn(paymentDrivers, driver)) throw new Error(`payment: selected driver '${driver}' is unavailable`);
  return paymentDrivers[/** @type {keyof typeof paymentDrivers} */ (driver)];
}
/** @param {string} value @param {string} component @param {boolean} [allowPath] */
function configuredOrigin(value, component, allowPath = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== '/') || (url.port && url.port !== '443') || !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') || /^\d+[.\d]*$/.test(url.hostname)) throw new Error();
  } catch { throw new Error(`${component}: endpoint must be a public HTTPS origin`); }
}
/** @param {Record<string,string|undefined>} [environment] */
export function validateProviderConfiguration(environment = process.env) {
  if (!['production', 'staging', 'development', 'preview'].includes(environment.ELEMARKET_ENV || '')) throw new Error('ELEMARKET_ENV must be a canonical environment identifier');
  for (const component of Object.keys(components)) {
    const selected = selectedProvider(component, environment);
    const missing = selected.required.filter(key => !environment[key]?.trim());
    if (missing.length) throw new Error(`${component} provider '${selected.key}': missing configuration ${missing.join(', ')}`);
  }
  if (selectedProvider('search', environment).key === 'typesense') configuredOrigin(environment.TYPESENSE_HOST || '', 'search provider typesense');
  const storage = selectedProvider('storage', environment).key;
  if (storage === 's3') {
    configuredOrigin(environment.STORAGE_ENDPOINT || '', 'storage provider s3');
    if (!/^[a-z0-9-]{1,64}$/.test(environment.STORAGE_REGION || '')) throw new Error('storage provider s3: invalid STORAGE_REGION');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(environment.STORAGE_BUCKET || '')) throw new Error('storage provider s3: invalid STORAGE_BUCKET');
  }
  if (storage === 'r2') {
    if (!/^[a-f0-9]{32}$/i.test(environment.CLOUDFLARE_R2_ACCOUNT_ID || '')) throw new Error('storage provider r2: invalid CLOUDFLARE_R2_ACCOUNT_ID');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(environment.CLOUDFLARE_R2_BUCKET || '')) throw new Error('storage provider r2: invalid CLOUDFLARE_R2_BUCKET');
  }
  if (selectedProvider('kyb', environment).key === 'fylings' && environment.FYLINGS_BASE_URL) configuredOrigin(environment.FYLINGS_BASE_URL, 'kyb provider fylings');
  if (selectedProvider('push', environment).key === 'fcm') {
    try {
      const account = JSON.parse(environment.FCM_SERVICE_ACCOUNT_JSON || '');
      if (![account.project_id, account.client_email, account.private_key].every(x => typeof x === 'string' && x.trim())) throw new Error();
    } catch { throw new Error('push provider fcm: invalid FCM_SERVICE_ACCOUNT_JSON (project_id/client_email/private_key required)'); }
  }
  if (selectedProvider('otp', environment).key === 'arkesel' && (environment.ARKESEL_OTP_SENDER_ID?.trim().length || 0) > 11) throw new Error('otp provider arkesel: invalid ARKESEL_OTP_SENDER_ID');
  const delivery = environment.ELEMARKET_DELIVERY_PROVIDER?.trim();
  if (!delivery) throw new Error('delivery: missing configuration ELEMARKET_DELIVERY_PROVIDER');
  if (!/^[a-z0-9_-]{2,64}$/.test(delivery) || delivery === 'preview') throw new Error('delivery: invalid shared-environment provider identifier');
  const deliveryPrefix = `ELEMARKET_DELIVERY_${delivery.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  for (const suffix of ['ENDPOINT','SECRET']) if (!environment[`${deliveryPrefix}_${suffix}`]?.trim()) throw new Error(`delivery provider '${delivery}': missing configuration ${deliveryPrefix}_${suffix}`);
  configuredOrigin(environment[`${deliveryPrefix}_ENDPOINT`] || '', 'delivery', true);
  const providers = (environment.ELEMARKET_PAYMENT_PROVIDERS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!providers.length) throw new Error('payment: missing configuration ELEMARKET_PAYMENT_PROVIDERS');
  const prefixes = providers.map(paymentPrefix);
  if (new Set(prefixes).size !== prefixes.length) throw new Error('payment: provider aliases collide');
  for (const key of providers) {
    const prefix = paymentPrefix(key);
    const driverKey = environment[`${prefix}_DRIVER`]?.trim();
    if (!driverKey) throw new Error(`payment provider '${key}': missing configuration ${prefix}_DRIVER`);
    const driver = paymentDriver(driverKey);
    const missing = driver.required.map(suffix => `${prefix}_${suffix}`).filter(name => !environment[name]?.trim());
    if (missing.length) throw new Error(`payment provider '${key}': missing configuration ${missing.join(', ')}`);
  }
  // Provider-neutral settlement: the selected payment driver must only satisfy
  // the capabilities it actually implements. Delivery + 24h/no-dispute is an
  // ELEMARKET merchant-withdrawal policy enforced server-side, not a provider capability.
}
