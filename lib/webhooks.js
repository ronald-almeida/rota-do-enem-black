import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const delivered = new Map();
const sending = new Map();
const MAX_AGE = 7 * 86400000;

export function webhookAuthorized(token) {
  const expected = process.env.NEXUM_WEBHOOK_TOKEN;
  if (!expected || typeof token !== 'string') return false;
  const received = Buffer.from(token), secret = Buffer.from(expected);
  return received.length === secret.length && timingSafeEqual(received, secret);
}

export function webhookConfiguration() {
  if (!process.env.NEXUM_WEBHOOK_TOKEN) return undefined;
  const site = new URL(process.env.PUBLIC_SITE_URL || 'https://rota-do-enem-black.vercel.app');
  if (site.protocol !== 'https:') throw new Error('Webhook requires HTTPS');
  return { url: new URL('/api/webhooks/nexum', site).href, token: process.env.NEXUM_WEBHOOK_TOKEN };
}

function atlasCallbackToken() {
  return process.env.ATLAS_SECRET_KEY ? createHmac('sha256', process.env.ATLAS_SECRET_KEY).update('rota-atlas-postback-v1').digest('hex') : null;
}

export function atlasWebhookConfiguration() {
  const token = atlasCallbackToken();
  if (!token) return undefined;
  const url = new URL('/api/webhooks/atlas', process.env.PUBLIC_SITE_URL || 'https://rota-do-enem-black.vercel.app');
  if (url.protocol !== 'https:') throw new Error('Webhook requires HTTPS');
  url.searchParams.set('token', token);
  return url.href;
}

export function atlasWebhookAuthorized(token) {
  const expected = atlasCallbackToken();
  if (!expected || typeof token !== 'string') return false;
  const received = Buffer.from(token), secret = Buffer.from(expected);
  return received.length === secret.length && timingSafeEqual(received, secret);
}

export async function receiveNexumWebhook(body) {
  if (body.event !== 'pix.status_changed') return { ok: true, ignored: true };
  const transaction = body.transaction;
  const id = body.tx_id;
  if (typeof id !== 'string' || !/^[\w-]{1,120}$/.test(id) || transaction?.id !== id || transaction.amount !== 247 || !/^rota-nexum-247-[a-f0-9-]{36}$/i.test(transaction.external_reference || '') || transaction.status !== body.status) {
    return { ok: true, ignored: true };
  }
  // Only the two documented webhook events are forwarded; refunds and failures never signal a sale.
  const state = body.status === 'PAID' && body.paid === true ? 'paid' : body.status === 'PENDING' && body.paid !== true ? 'pending' : null;
  if (!state) return { ok: true, ignored: true };
  return notifyPix('nexum', id, state);
}

export async function notifyPix(provider, id, state) {
  // Preserve the ID used for existing Nexum deliveries during the migration.
  const key = (provider === 'atlas' ? 'atlas:' : '') + id + ':' + state;
  for (const [event, at] of delivered) if (at + MAX_AGE < Date.now()) delivered.delete(event);
  if (delivered.has(key)) return { ok: true, duplicate: true };
  if (sending.has(key)) return sending.get(key);
  const work = (async () => {
    const raw = state === 'paid' ? process.env.PUSHCUT_PIX_PAID_URL : process.env.PUSHCUT_PIX_PENDING_URL;
    let url;
    try { url = new URL(raw); } catch { throw notificationError('configuration'); }
    if (url.protocol !== 'https:' || url.hostname !== 'api.pushcut.io' || !/^\/[^/]+\/notifications\/[^/]+$/.test(url.pathname) || url.username || url.password || url.port || url.search || url.hash) throw notificationError('configuration');
    // Keep the user's configured notification text; no customer data is sent to Pushcut.
    // A stable notification ID lets Pushcut identify retries across serverless instances.
    const notificationId = 'rota-' + createHash('sha256').update(key).digest('hex').slice(0, 32);
    let response;
    try { response = await fetch(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId }), redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { throw notificationError('network_or_timeout'); }
    if (!response.ok) throw notificationError('upstream_' + response.status);
    if (delivered.size >= 10000) delivered.delete(delivered.keys().next().value);
    delivered.set(key, Date.now());
    console.info('pix_notification_delivered', JSON.stringify({ transactionId: id, state }));
    return { ok: true };
  })();
  sending.set(key, work);
  try { return await work; } finally { sending.delete(key); }
}

function notificationError(category) {
  console.warn('pix_notification_failed', JSON.stringify({ category }));
  const error = new Error('Notification delivery unavailable'); error.status = 503;
  return error;
}
