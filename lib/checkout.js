import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const PRICE = 397;
export const PRODUCT = 'Black Vitalícia 2026 - Rota do Enem';
export const WHATSAPP = '5575988393742';
export const REFUND_URL = 'https://reembolso-de-alunos.vercel.app/';
const BASE = 'https://atlaspags.com/api/v1';
const localKey = randomBytes(32).toString('hex');
const mockOrders = new Map();
export const reviewMode = () => process.env.LOCAL_REVIEW === '1' && !process.env.VERCEL && process.env.NODE_ENV !== 'production';
export const configured = () => reviewMode() || Boolean(process.env.ATLAS_SECRET_KEY);
const signingKey = () => process.env.ORDER_SIGNING_SECRET || process.env.ATLAS_SECRET_KEY || (reviewMode() ? localKey : null);
export class CheckoutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function validCpf(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (let size = 9; size < 11; size++) {
    const sum = [...d.slice(0, size)].reduce((a, n, i) => a + Number(n) * (size + 1 - i), 0);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(d[size])) return false;
  }
  return true;
}
export function customerFrom(body) {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const confirmation = typeof body.emailConfirmation === 'string' ? body.emailConfirmation.trim().toLowerCase() : '';
  const document = String(body.document ?? '').replace(/\D/g, '');
  const phone = String(body.phone ?? '').replace(/\D/g, '');
  if (name.length < 3 || name.length > 120 || !name.includes(' ')) throw new CheckoutError('Informe seu nome completo.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CheckoutError('Informe um e-mail válido.');
  if (email !== confirmation) throw new CheckoutError('Os e-mails precisam ser iguais.');
  if (!validCpf(document)) throw new CheckoutError('Confira o CPF informado.');
  if (!/^[1-9]\d{9,10}$/.test(phone)) throw new CheckoutError('Informe um celular com DDD.');
  if (body.accepted !== true) throw new CheckoutError('Confirme que leu as condições da compra e o prazo de acesso.');
  return { name, email, document, phone };
}
export function signOrder(order) {
  const key = signingKey();
  if (!key) throw new CheckoutError('Pagamento temporariamente indisponível.', 503);
  const payload = Buffer.from(JSON.stringify({ id: order.id, order: order.external_id, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
export function verifyOrder(token) {
  const key = signingKey();
  if (!key || typeof token !== 'string' || token.length > 2000) throw new CheckoutError('Sessão do pedido inválida. Volte ao checkout ou fale com a equipe.', 401);
  const [payload, signature, extra] = token.split('.');
  const expected = createHmac('sha256', key).update(payload || '').digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new CheckoutError('Sessão do pedido inválida.', 401);
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new CheckoutError('Sessão inválida.', 401); }
  if (!/^[\w-]{1,120}$/.test(data.id) || typeof data.order !== 'string' || !Number.isFinite(data.exp) || data.exp < Date.now()) throw new CheckoutError('Sua sessão expirou. Fale com a equipe para consultar a compra.', 401);
  return data;
}
async function atlas(path, options = {}) {
  if (!process.env.ATLAS_SECRET_KEY) throw new CheckoutError('O pagamento está temporariamente indisponível. Fale com a equipe pelo WhatsApp.', 503);
  let response;
  try {
    response = await fetch(BASE + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${process.env.ATLAS_SECRET_KEY}`, 'Content-Type': 'application/json', ...options.headers } });
  } catch { throw new CheckoutError('Não foi possível confirmar a resposta do pagamento. Tente novamente com os mesmos dados.', 503); }
  if (!response.ok) {
    const status = response.status;
    if (status === 409) throw new CheckoutError('Os dados deste pedido mudaram. Recarregue a página para tentar novamente.', 409);
    if (status === 422) throw new CheckoutError('Confira seus dados de cadastro e tente novamente.', 422);
    if (status === 429) throw new CheckoutError('Aguarde um minuto antes de tentar novamente.', 429);
    throw new CheckoutError('Não foi possível gerar ou consultar o Pix agora. Tente novamente ou fale com a equipe.', 503);
  }
  try { return await response.json(); } catch { throw new CheckoutError('Resposta de pagamento indisponível. Tente novamente.', 503); }
}
function assertCharge(charge, expectedOrder) {
  if (!charge || typeof charge.id !== 'string' || !/^[\w-]{1,120}$/.test(charge.id) || charge.amount !== PRICE || charge.method !== 'pix' || charge.external_id !== expectedOrder || charge.metadata?.product !== 'rota-black-2026' || (!reviewMode() && charge.livemode !== true)) throw new CheckoutError('Não foi possível validar os dados deste pagamento. Fale com a equipe.', 502);
  if (!['pending', 'paid', 'failed', 'expired', 'refunded', 'chargeback'].includes(charge.status)) throw new CheckoutError('Status de pagamento indisponível.', 502);
  return charge;
}
export function safeCharge(charge) {
  const result = { id: charge.id, order: charge.external_id, status: charge.status, amount: PRICE, paidAt: charge.paid_at || null, refunded: Number(charge.refunded || 0), review: reviewMode() };
  if (charge.status === 'pending') {
    const pix = charge.pix;
    if (!pix?.code || typeof pix.code !== 'string' || !Number.isFinite(Date.parse(pix.expires_at))) throw new CheckoutError('O Pix não ficou disponível. Tente novamente com os mesmos dados.', 502);
    result.pix = { code: pix.code, expiresAt: pix.expires_at, image: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(pix.qr_code_image || '') ? pix.qr_code_image : null };
  }
  return result;
}
export async function createCharge(body) {
  const customer = customerFrom(body);
  if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '')) throw new CheckoutError('Recarregue a página para iniciar um pedido.');
  const external_id = 'rota-' + body.requestId;
  const payload = { amount: PRICE, method: 'pix', customer, description: PRODUCT, external_id, metadata: { product: 'rota-black-2026' }, items: [{ name: PRODUCT, quantity: 1, unit_amount: PRICE }], checkout_url: (process.env.PUBLIC_SITE_URL || 'https://rota-do-enem-black.vercel.app').replace(/\/$/, '') + '/checkout' };
  let charge;
  if (reviewMode()) {
    if (!mockOrders.has(external_id)) mockOrders.set(external_id, { ...payload, id: 'demo-' + body.requestId, status: 'pending', livemode: false, created_at: new Date().toISOString(), pix: { code: 'DEMONSTRACAO-SEM-VALOR-DE-PAGAMENTO', expires_at: new Date(Date.now() + 1800000).toISOString() } });
    charge = mockOrders.get(external_id);
  } else charge = await atlas('/charges', { method: 'POST', headers: { 'Idempotency-Key': external_id }, body: JSON.stringify(payload) });
  assertCharge(charge, external_id);
  return { ...safeCharge(charge), token: signOrder(charge) };
}
export async function getCharge(token) {
  const session = verifyOrder(token);
  const charge = reviewMode() ? mockOrders.get(session.order) : await atlas('/charges/' + encodeURIComponent(session.id));
  assertCharge(charge, session.order);
  if (charge.id !== session.id) throw new CheckoutError('Pedido inválido.', 401);
  return safeCharge(charge);
}
export function simulatePayment(token) {
  if (!reviewMode()) throw new CheckoutError('Página não encontrada.', 404);
  const session = verifyOrder(token);
  const order = mockOrders.get(session.order);
  if (!order) throw new CheckoutError('Pedido não encontrado.', 404);
  order.status = 'paid'; order.paid_at = new Date().toISOString();
}
