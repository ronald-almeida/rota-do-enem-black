import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const PRICE = 247;
export const PRODUCT = 'Black Vitalícia 2026 - Rota do Enem';
export const WHATSAPP = '5575988393742';
export const REFUND_URL = 'https://reembolso-de-alunos.vercel.app/';
const BASE = 'https://atlaspags.com/api/v1';
const NEXUM_BASE = 'https://api.nexumpaybot.com/api/public';
const POLL_INTERVAL = 30000;
const statusCache = new Map();
const inFlight = new Map();
let availability;
const localKey = randomBytes(32).toString('hex');
const mockOrders = new Map();
// Brazilian national area codes, verified against the Ministry of Communications list.
const areaCodes = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export const reviewMode = () => process.env.LOCAL_REVIEW === '1' && !process.env.VERCEL && process.env.NODE_ENV !== 'production';
export const visualReview = () => reviewMode() || process.env.VERCEL_ENV === 'preview';
export const configured = () => reviewMode() || Boolean(process.env.NEXUM_API_CHAT_ID?.trim() && process.env.NEXUM_API_CREDENTIAL?.trim());
export async function paymentAvailable() {
  if (reviewMode()) return true;
  if (!configured()) return false;
  if (availability?.until > Date.now()) return availability.value;
  let value = false;
  try {
    const data = await nexum('/auth/validate');
    const account = data.account;
    value = data.authenticated === true && String(account?.chat_id) === process.env.NEXUM_API_CHAT_ID.trim() && account?.status === true && Number.isFinite(account.min_deposit) && Number.isFinite(account.max_deposit) && PRICE >= account.min_deposit && PRICE <= account.max_deposit;
    if (!value) console.warn('nexum_account_unavailable', JSON.stringify({ category: 'authentication_account_or_deposit_limits' }));
  } catch { /* The provider error is already sanitized and logged by nexum(). */ }
  availability = { value, until: Date.now() + 30000 };
  return value;
}
const signingKey = provider => process.env.ORDER_SIGNING_SECRET || (provider === 'atlas' ? process.env.ATLAS_SECRET_KEY : process.env.NEXUM_API_CREDENTIAL) || (reviewMode() ? localKey : null);
export class CheckoutError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; Object.assign(this, details); }
}
const diagnosticId = value => typeof value === 'string' && /^[\w.:-]{1,120}$/.test(value) ? value : undefined;
function rejectionCategory(message) {
  if (typeof message !== 'string') return 'unspecified';
  if (/nominal|forma de pagamento indisponível/i.test(message)) return 'payment_method_unavailable';
  if (/teto|valor máximo/i.test(message)) return 'amount_limit';
  if (/pausad/i.test(message)) return 'sales_paused';
  if (/verifica|liberada|bloqueada|permissão/i.test(message)) return 'account_restricted';
  if (/cpf|cnpj|dados inválidos/i.test(message)) return 'customer_validation';
  if (/checkout_url/i.test(message)) return 'checkout_url';
  return 'unspecified';
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
  if (!areaCodes.has(phone.slice(0, 2))) throw new CheckoutError('Confira o DDD do celular informado. Esse DDD não é válido no Brasil.');
  if (body.accepted !== true) throw new CheckoutError('Confirme que leu as condições da compra e o prazo de acesso.');
  return { name, email, document, phone };
}
export function signOrder(order) {
  const key = signingKey(order.provider || 'nexum');
  if (!key) throw new CheckoutError('Pagamento temporariamente indisponível.', 503);
  const payload = Buffer.from(JSON.stringify({ id: order.id, order: order.external_id, provider: order.provider || 'nexum', amount: order.amount, exp: order.exp || Date.now() + 7 * 86400000, pixExpiresAt: order.pixExpiresAt, checked: order.checked })).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
export function verifyOrder(token) {
  if (typeof token !== 'string' || token.length > 2000) throw new CheckoutError('Sessão do pedido inválida. Volte ao checkout ou fale com a equipe.', 401);
  const [payload, signature, extra] = token.split('.');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new CheckoutError('Sessão inválida.', 401); }
  if (!data || typeof data !== 'object') throw new CheckoutError('Sessão inválida.', 401);
  const provider = data.provider || 'atlas';
  const key = signingKey(provider);
  if (!key || !['atlas', 'nexum'].includes(provider)) throw new CheckoutError('Sessão do pedido inválida.', 401);
  const expected = createHmac('sha256', key).update(payload || '').digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new CheckoutError('Sessão do pedido inválida.', 401);
  if (!/^[\w-]{1,120}$/.test(data.id) || typeof data.order !== 'string' || !Number.isFinite(data.exp) || data.exp < Date.now()) throw new CheckoutError('Sua sessão expirou. Fale com a equipe para consultar a compra.', 401);
  if (provider === 'nexum' && data.amount !== PRICE) throw new CheckoutError('Valor do pedido inválido.', 401);
  return { ...data, provider, amount: provider === 'atlas' ? 397 : data.amount };
}
async function atlas(path, options = {}) {
  if (!process.env.ATLAS_SECRET_KEY) throw new CheckoutError('O pagamento está temporariamente indisponível. Fale com a equipe pelo WhatsApp.', 503);
  let response;
  try {
    response = await fetch(BASE + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${process.env.ATLAS_SECRET_KEY}`, 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    console.warn('atlas_request_failed', JSON.stringify({ operation: options.method === 'POST' ? 'create_charge' : 'get_charge', category: 'network_or_timeout' }));
    throw new CheckoutError('Não foi possível confirmar a resposta do pagamento. Tente novamente com os mesmos dados.', 503);
  }
  const reference = diagnosticId(response.headers.get('x-request-id'));
  let data;
  try { data = await response.json(); } catch { /* Non-JSON responses must not expose their body. */ }
  if (!response.ok) {
    const status = response.status;
    console.warn('atlas_request_failed', JSON.stringify({ operation: options.method === 'POST' ? 'create_charge' : 'get_charge', httpStatus: status, requestId: reference, code: diagnosticId(data?.error?.code), category: rejectionCategory(data?.error?.message) }));
    if (status === 409) throw new CheckoutError('Os dados deste pedido mudaram. Recarregue a página para tentar novamente.', 409, { reference });
    if (status === 422) throw new CheckoutError('Confira seus dados de cadastro e tente novamente.', 422, { reference });
    if (status === 429) throw new CheckoutError('Aguarde um minuto antes de tentar novamente.', 429, { reference });
    throw new CheckoutError('Não foi possível gerar ou consultar o Pix agora. Tente novamente ou fale com a equipe.', 503, { reference });
  }
  if (!data || typeof data !== 'object') throw new CheckoutError('Resposta de pagamento indisponível. Tente novamente.', 503, { reference });
  if (options.method === 'POST' || data.status === 'failed') {
    const log = data.status === 'failed' ? console.warn : console.info;
    log('atlas_charge_result', JSON.stringify({ operation: options.method === 'POST' ? 'create_charge' : 'get_charge', requestId: reference, chargeId: diagnosticId(data.id), order: diagnosticId(data.external_id), status: diagnosticId(data.status) }));
  }
  return data;
}
function assertCharge(charge, expectedOrder) {
  if (!charge || typeof charge.id !== 'string' || !/^[\w-]{1,120}$/.test(charge.id) || charge.amount !== 397 || charge.method !== 'pix' || charge.external_id !== expectedOrder || charge.metadata?.product !== 'rota-black-2026' || charge.livemode !== true) throw new CheckoutError('Não foi possível validar os dados deste pagamento. Fale com a equipe.', 502);
  if (!['pending', 'paid', 'failed', 'expired', 'refunded', 'chargeback'].includes(charge.status)) throw new CheckoutError('Status de pagamento indisponível.', 502);
  return charge;
}
export function safeCharge(charge) {
  const result = { id: charge.id, order: charge.external_id, status: charge.status, amount: charge.amount, paidAt: charge.paid_at || null, refunded: Number(charge.refunded || 0), review: reviewMode() };
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
  const external_id = 'rota-nexum-' + PRICE + '-' + body.requestId;
  const generatedName = customer.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (generatedName.length < 3 || !generatedName.includes(' ')) throw new CheckoutError('Informe seu nome completo usando letras.');
  const payload = { amount: PRICE, generatedName, generatedEmail: customer.email, generatedDocument: customer.document, externalReference: external_id };
  let data;
  if (reviewMode()) {
    if (!mockOrders.has(external_id)) mockOrders.set(external_id, { ok: true, tx_id: 'demo-' + body.requestId, amount: PRICE, status: 'PENDING', external_reference: external_id, qr_code_text: 'DEMONSTRACAO-SEM-VALOR-DE-PAGAMENTO', expires_in_seconds: 1800 });
    data = mockOrders.get(external_id);
  } else data = await nexum('/pix/create', { method: 'POST', headers: { 'Idempotency-Key': external_id }, body: JSON.stringify(payload) });
  const session = { id: data.tx_id, order: external_id, amount: PRICE, provider: 'nexum' };
  const result = normalizeNexum(data, session, true);
  if (['failed', 'expired', 'refunded', 'chargeback'].includes(result.status)) throw new CheckoutError('Não foi possível gerar o Pix desta tentativa. Tente novamente ou fale com a equipe.', 502, { code: 'PIX_CREATION_FAILED', reference: session.id, retryWithNewAttempt: true });
  session.pixExpiresAt = result.pix?.expiresAt;
  return withSnapshot(result, session);
}
export async function getCharge(token) {
  const session = verifyOrder(token);
  // Existing Atlas sessions remain readable; all new charges use Nexum.
  if (session.provider === 'atlas') {
    const charge = assertCharge(await atlas('/charges/' + encodeURIComponent(session.id)), session.order);
    if (charge.id !== session.id) throw new CheckoutError('Pedido inválido.', 401);
    return { ...safeCharge(charge), token, nextPollAt: Date.now() + POLL_INTERVAL };
  }
  if (reviewMode()) return withSnapshot(normalizeNexum(mockOrders.get(session.order), session), session);
  // A signed 30-second snapshot also works across serverless instances and the PDF route.
  const checked = session.checked;
  if (checked && checked.at <= Date.now() && checked.at + POLL_INTERVAL > Date.now()) return { id: session.id, order: session.order, amount: session.amount, status: checked.status, refunded: checked.refunded, paidAt: null, review: false, token, nextPollAt: checked.at + POLL_INTERVAL };
  const cached = statusCache.get(session.id);
  if (cached?.nextPollAt > Date.now()) return cached;
  if (inFlight.has(session.id)) return inFlight.get(session.id);
  const request = (async () => {
    const data = await nexum('/pix/status/' + encodeURIComponent(session.id));
    const result = withSnapshot(normalizeNexum(data, session), session);
    for (const [id, entry] of statusCache) if (entry.nextPollAt <= Date.now()) statusCache.delete(id);
    if (statusCache.size < 1000) statusCache.set(session.id, result);
    return result;
  })();
  inFlight.set(session.id, request);
  try { return await request; } finally { inFlight.delete(session.id); }
}
export function simulatePayment(token) {
  if (!reviewMode()) throw new CheckoutError('Página não encontrada.', 404);
  const session = verifyOrder(token);
  const order = mockOrders.get(session.order);
  if (!order) throw new CheckoutError('Pedido não encontrado.', 404);
  order.status = 'PAID';
}

function withSnapshot(result, session) {
  const checked = { status: result.status, refunded: result.refunded, at: Date.now() };
  const token = signOrder({ ...session, external_id: session.order, checked });
  return { ...result, token, nextPollAt: Date.now() + (reviewMode() ? 1000 : POLL_INTERVAL) };
}

function normalizeNexum(data, session, creating = false) {
  if (data?.ok !== true || typeof data.tx_id !== 'string' || !/^[\w-]{1,120}$/.test(data.tx_id) || data.tx_id !== session.id || data.amount !== session.amount || (data.external_reference != null && data.external_reference !== session.order)) throw new CheckoutError('Não foi possível validar os dados deste pagamento. Fale com a equipe.', 502);
  const states = { PENDING: 'pending', PENDENTE: 'pending', PROCESSING: 'pending', WAITING: 'pending', INITIATED: 'pending', CREATED: 'pending', RESERVED: 'pending', UNKNOWN: 'pending', PAID: 'paid', APPROVED: 'paid', COMPLETED: 'paid', SUCCESS: 'paid', CONFIRMED: 'paid', COMPLETO: 'paid', FAILED: 'failed', FAIL: 'failed', ERROR: 'failed', REJECTED: 'failed', REFUNDED: 'refunded', CANCELLED: 'failed', CANCELED: 'failed', EXPIRED: 'expired' };
  const status = Object.hasOwn(states, data.status) ? states[data.status] : null;
  if (!status) throw new CheckoutError('Status de pagamento indisponível.', 502);
  const result = { id: data.tx_id, order: session.order, status, amount: session.amount, paidAt: null, refunded: status === 'refunded' ? session.amount : 0, review: reviewMode() };
  if (status === 'pending' && typeof data.qr_code_text === 'string' && data.qr_code_text.length > 0 && data.qr_code_text.length < 10000) {
    const rawImage = data.qr_code_base64;
    const image = typeof rawImage === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(rawImage) ? 'data:image/png;base64,' + rawImage : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(rawImage || '') ? rawImage : null;
    const expiresAt = session.pixExpiresAt || (Number.isFinite(data.expires_in_seconds) && data.expires_in_seconds > 0 ? new Date(Date.now() + data.expires_in_seconds * 1000).toISOString() : null);
    result.pix = { code: data.qr_code_text, image, expiresAt };
  } else if (creating && status === 'pending' && !['PROCESSING', 'UNKNOWN'].includes(data.status) && data.reconciliation_required !== true) {
    throw new CheckoutError('O código Pix ainda não ficou disponível. Tente novamente com os mesmos dados.', 503, { reference: data.tx_id });
  }
  return result;
}

async function nexum(path, options = {}) {
  if (!configured()) throw new CheckoutError('O pagamento está temporariamente indisponível. Tente novamente mais tarde.', 503);
  const operation = path === '/auth/validate' ? 'validate_credentials' : options.method === 'POST' ? 'create_charge' : 'get_charge';
  let response;
  try {
    response = await fetch(NEXUM_BASE + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Origin: process.env.NEXUM_API_ORIGIN || 'https://nexumpaybot.com', 'X-API-Chat-Id': process.env.NEXUM_API_CHAT_ID.trim(), 'X-API-Credential': process.env.NEXUM_API_CREDENTIAL.trim(), 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    console.warn('nexum_request_failed', JSON.stringify({ operation, category: 'network_or_timeout' }));
    throw new CheckoutError('Não foi possível confirmar a resposta do pagamento. Tente novamente com os mesmos dados.', 503);
  }
  const reference = diagnosticId(response.headers.get('x-request-id'));
  let data;
  try { data = await response.json(); } catch { /* Never expose upstream bodies or credentials. */ }
  if (!response.ok || data?.ok !== true) {
    console.warn('nexum_request_failed', JSON.stringify({ operation, httpStatus: response.status, requestId: reference, code: diagnosticId(data?.code), category: response.status === 401 || response.status === 403 ? 'authentication_or_origin' : 'upstream_rejected' }));
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
      throw new CheckoutError('Aguarde um instante antes de consultar ou tentar novamente.', 429, { reference, retryAfter: Math.max(30, Number.isFinite(seconds) ? seconds : 30) });
    }
    if (response.status === 409) throw new CheckoutError('Os dados deste pedido mudaram. Volte ao checkout e confira os dados.', 409, { reference });
    if (response.status === 422) throw new CheckoutError('Confira seus dados de cadastro e tente novamente.', 422, { reference });
    throw new CheckoutError('Não foi possível gerar ou consultar o Pix agora. Tente novamente ou fale com a equipe.', 503, { reference });
  }
  if (operation === 'create_charge') console.info('nexum_charge_result', JSON.stringify({ operation, chargeId: diagnosticId(data.tx_id), status: diagnosticId(data.status) }));
  return data;
}
