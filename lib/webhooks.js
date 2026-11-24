import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { notificationStore } from './notification-store.js';

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

export function createNotifier(store = notificationStore, send = (...args) => fetch(...args)) {
  const completed = new Set(); // Optimization only; Blob is authoritative across instances and deployments.
  return async function notify(provider, id, state) {
    if (!['atlas', 'nexum'].includes(provider) || !['pending', 'paid'].includes(state) || !/^[\w-]{1,120}$/.test(id)) throw notificationError('invalid_event');
    // Preserve the ID used for existing Nexum deliveries during the migration.
    const key = (provider === 'nexum' ? '' : provider + ':') + id + ':' + state;
    if (completed.has(key)) return { ok: true, duplicate: true };
    const raw = state === 'paid' ? process.env.PUSHCUT_PIX_PAID_URL : process.env.PUSHCUT_PIX_PENDING_URL;
    let url;
    try { url = new URL(raw); } catch { throw notificationError('configuration'); }
    if (url.protocol !== 'https:' || url.hostname !== 'api.pushcut.io' || !/^\/[^/]+\/notifications\/[^/]+$/.test(url.pathname) || url.username || url.password || url.port || url.search || url.hash) throw notificationError('configuration');
    // Keep the user's configured notification text; no customer data is sent to Pushcut.
    // A stable notification ID lets Pushcut identify retries across serverless instances.
    const notificationId = 'rota-' + createHash('sha256').update(key).digest('hex').slice(0, 32);
    let claim;
    try { claim = await store.claim(notificationId); } catch { throw notificationError('storage_unavailable'); }
    if (!claim) return { ok: true, duplicate: true };
    let response;
    try { response = await send(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId }), redirect: 'error', signal: AbortSignal.timeout(4000) }); }
    catch {
      await store.finish(claim, 'uncertain').catch(() => {});
      console.warn('pix_notification_uncertain', JSON.stringify({ provider, transactionId: id, state, category: 'network_or_timeout' }));
      return { ok: true, uncertain: true };
    }
    if (!response.ok) {
      // Only explicit rejection may be retried. A server error can occur after delivery.
      const retryable = response.status >= 400 && response.status < 500;
      await store.finish(claim, retryable ? 'retryable' : 'uncertain');
      if (retryable) throw notificationError('upstream_' + response.status);
      console.warn('pix_notification_uncertain', JSON.stringify({ provider, transactionId: id, state, httpStatus: response.status }));
      return { ok: true, uncertain: true };
    }
    try { await store.finish(claim, 'delivered'); } catch { throw notificationError('delivery_record_unavailable'); }
    if (completed.size < 1000) completed.add(key);
    console.info('pix_notification_delivered', JSON.stringify({ transactionId: id, state }));
    return { ok: true };
  };
}
export const notifyPix = createNotifier();

function notificationError(category) {
  console.warn('pix_notification_failed', JSON.stringify({ category }));
  const error = new Error('Notification delivery unavailable'); error.status = 503;
  return error;
}
