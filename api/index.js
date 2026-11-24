import { readFile } from 'node:fs/promises';
import { notificationStorageAvailable } from '../lib/notification-store.js';
import { webhookAuthorized, receiveNexumWebhook, atlasWebhookAuthorized } from '../lib/webhooks.js';
import { paymentAvailable, reviewMode, visualReview, createCharge, getCharge, receiveAtlasWebhook, simulatePayment, CheckoutError, PRICE, PRODUCT, WHATSAPP, REFUND_URL } from '../lib/checkout.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) throw new CheckoutError('Dados enviados excedem o limite.', 413); }
  if (Buffer.byteLength(raw) > 16384) throw new CheckoutError('Dados enviados excedem o limite.', 413);
  try { const body = JSON.parse(raw); if (!body || Array.isArray(body) || typeof body !== 'object') throw Error(); return body; } catch { throw new CheckoutError('Dados inválidos.'); }
}
const attempts = new Map();
function limit(req) {
  const ip = req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'local';
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const entry = attempts.get(ip) || { count: 0, until: now + 60000 };
  if (++entry.count > 15) throw new CheckoutError('Muitas tentativas. Aguarde um minuto.', 429);
  attempts.set(ip, entry);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  const route = new URL(req.url, 'http://localhost').pathname;
  try {
    if (route === '/api/webhooks/atlas') {
      if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
      if (!atlasWebhookAuthorized(new URL(req.url, 'http://localhost').searchParams.get('token'))) throw new CheckoutError('Webhook não autorizado.', 401);
      if (!String(req.headers['content-type']).includes('application/json')) throw new CheckoutError('Envie os dados em JSON.', 415);
      return json(200, await receiveAtlasWebhook(await readBody(req)));
    }
    if (route === '/api/webhooks/nexum') {
      if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
      if (!webhookAuthorized(req.headers['x-webhook-token'])) throw new CheckoutError('Webhook não autorizado.', 401);
      if (!String(req.headers['content-type']).includes('application/json')) throw new CheckoutError('Envie os dados em JSON.', 415);
      return json(200, await receiveNexumWebhook(await readBody(req)));
    }
    if (route === '/api/review-thanks' && req.method === 'GET') {
      if (!visualReview()) throw new CheckoutError('Página não encontrada.', 404);
      const html = (await readFile(new URL('../public/obrigado.html', import.meta.url), 'utf8')).replace('/thanks.js', '/review-thanks.js');
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
    }
    if (route === '/api/review-pdf' && req.method === 'GET') {
      if (!visualReview()) throw new CheckoutError('Página não encontrada.', 404);
      const pdf = await readFile(new URL('../private/introducao-rota-do-enem.pdf', import.meta.url));
      res.setHeader('Content-Type', 'application/pdf');res.setHeader('Content-Disposition', 'attachment; filename="introducao-rota-do-enem.pdf"');return res.end(pdf);
    }
    if (route === '/api/config' && req.method === 'GET') {
      const [available, notificationsAvailable] = await Promise.all([paymentAvailable(), reviewMode() ? false : notificationStorageAvailable()]);
      return json(200, { available, notificationsAvailable, review: reviewMode(), price: PRICE, product: PRODUCT, whatsapp: WHATSAPP, refundUrl: REFUND_URL });
    }
    if (route === '/api/intro' && req.method === 'GET') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const order = await getCharge(token);
      if (order.status !== 'paid' || order.refunded > 0) throw new CheckoutError('O PDF fica disponível após a confirmação do pagamento.', 403);
      const pdf = await readFile(new URL('../private/introducao-rota-do-enem.pdf', import.meta.url));
      res.statusCode = 200; res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="introducao-rota-do-enem.pdf"'); return res.end(pdf);
    }
    if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (new URL(origin).host !== host) throw new CheckoutError('Origem não permitida.', 403);
    }
    if (!String(req.headers['content-type']).includes('application/json')) throw new CheckoutError('Envie os dados em JSON.', 415);
    const body = await readBody(req);
    if (route === '/api/checkout') { limit(req); return json(200, await createCharge(body)); }
    if (route === '/api/order') return json(200, await getCharge(body.token));
    if (route === '/api/review/pay') { simulatePayment(body.token); return json(200, { ok: true }); }
    return json(404, { error: 'Página não encontrada.' });
  } catch (error) {
    if (!(error instanceof CheckoutError)) console.error('checkout_internal_error', error.name);
    return json(error.status || 500, error instanceof CheckoutError
      ? { error: error.message, code: error.code, reference: error.reference, retryAfter: error.retryAfter, retryWithNewAttempt: error.retryWithNewAttempt === true }
      : { error: 'Não foi possível concluir. Tente novamente ou fale com a equipe.' });
  }
}
