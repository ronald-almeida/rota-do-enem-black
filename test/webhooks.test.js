import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import handler from '../api/index.js';
import { createCharge, receiveAtlasWebhook } from '../lib/checkout.js';
import { webhookAuthorized, receiveNexumWebhook, webhookConfiguration, atlasWebhookConfiguration, atlasWebhookAuthorized } from '../lib/webhooks.js';
import { notificationStore } from '../lib/notification-store.js';
import { fakeNotificationStore } from './fixtures/notification-store.mjs';

const pendingUrl = 'https://api.pushcut.io/test-secret/notifications/pending';
const paidUrl = 'https://api.pushcut.io/test-secret/notifications/paid';
function event(id, status = 'PENDING') { return { event: 'pix.status_changed', tx_id: id, status, paid: status === 'PAID', transaction: { id, status, amount: 247, external_reference: 'rota-nexum-247-10000000-0000-4000-8000-000000000001' }, customer: { email: 'private@example.com', document: '52998224725' } }; }
async function setup(run) {
  const store = fakeNotificationStore();
  const claim = mock.method(notificationStore, 'claim', store.claim), finish = mock.method(notificationStore, 'finish', store.finish);
  const originalFetch = globalThis.fetch;
  const keys = ['NEXUM_WEBHOOK_TOKEN', 'PUSHCUT_PIX_PENDING_URL', 'PUSHCUT_PIX_PAID_URL', 'NEXUM_API_CHAT_ID', 'NEXUM_API_CREDENTIAL', 'LOCAL_REVIEW', 'ATLAS_SECRET_KEY', 'ATLAS_NOTIFICATIONS_MODE'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.NEXUM_WEBHOOK_TOKEN = 'test-webhook-secret'; process.env.PUSHCUT_PIX_PENDING_URL = pendingUrl; process.env.PUSHCUT_PIX_PAID_URL = paidUrl;
  process.env.NEXUM_API_CHAT_ID = '1000000000'; process.env.NEXUM_API_CREDENTIAL = 'test-credential'; delete process.env.LOCAL_REVIEW;
  process.env.ATLAS_SECRET_KEY = 'atlas-test-secret';
  delete process.env.ATLAS_NOTIFICATIONS_MODE;
  try { await run(originalFetch); } finally { claim.mock.restore(); finish.mock.restore(); globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

test('webhook exige segredo correto e configura callback HTTPS por cobrança', async () => setup(async () => {
  assert.equal(webhookAuthorized(undefined), false); assert.equal(webhookAuthorized('wrong'), false); assert.equal(webhookAuthorized('test-webhook-secret'), true);
  assert.deepEqual(webhookConfiguration(), { url: 'https://rota-do-enem-black.vercel.app/api/webhooks/nexum', token: 'test-webhook-secret' });
  assert.equal(atlasWebhookAuthorized(new URL(atlasWebhookConfiguration()).searchParams.get('token')), true);
  assert.equal(atlasWebhookAuthorized('wrong'), false); assert.equal(atlasWebhookAuthorized('é'.repeat(64)), false);
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.postback_url, atlasWebhookConfiguration());
    return Response.json({ id: 'callback_created', amount: 397, status: 'pending', method: 'pix', livemode: true, metadata: body.metadata, external_id: body.external_id, pix: { code: '000201TEST', expires_at: new Date(Date.now() + 1800000).toISOString() } });
  };
  const created = await createCharge({ name: 'Pessoa Teste', email: 'aluno@example.com', emailConfirmation: 'aluno@example.com', document: '52998224725', phone: '11999999999', accepted: true, requestId: '10000000-0000-4000-8000-000000000001' });
  assert.doesNotMatch(JSON.stringify(created), /test-webhook-secret|pushcut|test-credential|atlas-test-secret|postback_url/);
}));

const atlasOrder = 'rota-atlas-397-10000000-0000-4000-8000-000000000001';
function atlasEvent(id, state = 'pending') { return { type: 'transaction.' + state, livemode: true, data: { id, external_id: atlasOrder, status: state } }; }
function atlasCharge(id, state = 'pending') { return { id, external_id: atlasOrder, amount: 397, status: state, method: 'pix', livemode: true, metadata: { product: 'rota-black-2026' } }; }

test('avisos diretos no painel Atlas impedem o segundo envio por pedidos novos e antigos', async () => setup(async () => {
  process.env.ATLAS_NOTIFICATIONS_MODE = 'gateway';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(url, 'https://atlaspags.com/api/v1/charges');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(Object.hasOwn(body, 'postback_url'), false);
    return Response.json({ ...atlasCharge('direct_panel'), pix: { code: '000201TEST', expires_at: new Date(Date.now() + 1800000).toISOString() } });
  };
  const created = await createCharge({ name: 'Pessoa Teste', email: 'aluno@example.com', emailConfirmation: 'aluno@example.com', document: '52998224725', phone: '11999999999', accepted: true, requestId: '10000000-0000-4000-8000-000000000001' });
  assert.equal(created.amount, 397);
  assert.deepEqual(await receiveAtlasWebhook(atlasEvent('older_order')), { ok: true, ignored: true });
  assert.deepEqual(await receiveAtlasWebhook(atlasEvent('older_order', 'paid')), { ok: true, ignored: true });
  assert.equal(calls.length, 1);
}));

test('Atlas só notifica depois de consultar e validar o pagamento no servidor', async () => setup(async () => {
  const sent = []; let charge = atlasCharge('atlas_notice');
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://atlaspags.com/api/v1/charges/')) {
      assert.equal(options.headers.Authorization, 'Bearer atlas-test-secret'); return Response.json(charge);
    }
    sent.push(url); return Response.json({ ok: true });
  };
  assert.equal((await receiveAtlasWebhook(atlasEvent(charge.id))).ok, true);
  assert.equal((await receiveAtlasWebhook(atlasEvent(charge.id, 'paid'))).ignored, true); assert.equal(sent.length, 1);
  charge.status = 'paid'; assert.equal((await receiveAtlasWebhook(atlasEvent(charge.id, 'paid'))).ok, true);
  assert.equal((await receiveAtlasWebhook(atlasEvent(charge.id, 'paid'))).duplicate, true);
  assert.deepEqual(sent, [pendingUrl, paidUrl]);
  charge = { ...charge, refunded: 1 }; assert.equal((await receiveAtlasWebhook(atlasEvent(charge.id, 'paid'))).ignored, true);
  charge = { ...charge, amount: 247 }; await assert.rejects(receiveAtlasWebhook(atlasEvent(charge.id, 'paid')), /validar/);
  assert.equal((await receiveAtlasWebhook({ ...atlasEvent(charge.id), livemode: false })).ignored, true);
  assert.equal((await receiveAtlasWebhook({ type: 'webhook.test' })).ignored, true);
  assert.equal(sent.length, 2);
}));

test('endpoint Atlas autentica callback antes de consultar e não confia no status recebido', async () => setup(async originalFetch => {
  const server = createServer(handler).listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
  let queried = 0, sent = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://atlaspags.com/')) { queried++; return Response.json(atlasCharge('atlas_route')); }
    if (String(url).startsWith('https://api.pushcut.io/')) { sent++; return Response.json({ ok: true }); }
    return originalFetch(url, options);
  };
  const post = (query, body) => originalFetch(base + '/api/webhooks/atlas' + query, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://atlaspags.com' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('?token=wrong', atlasEvent('atlas_route'))).status, 401); assert.equal(queried, 0);
    const validQuery = new URL(atlasWebhookConfiguration()).search;
    assert.equal((await post(validQuery, atlasEvent('atlas_route', 'paid'))).status, 200); assert.equal(sent, 0);
    assert.equal((await post(validQuery, atlasEvent('atlas_route'))).status, 200); assert.equal(sent, 1);
    assert.equal((await originalFetch(base + '/api/webhooks/atlas')).status, 405);
  } finally { server.close(); }
}));

test('pendente e pago acionam links distintos, sem enviar dados do comprador', async () => setup(async () => {
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ success: true }); };
  assert.equal((await receiveNexumWebhook(event('notification_a'))).ok, true);
  assert.equal((await receiveNexumWebhook(event('notification_a', 'PAID'))).ok, true);
  assert.deepEqual(calls.map(call => call.url), [pendingUrl, paidUrl]);
  for (const call of calls) { assert.equal(call.options.method, 'POST'); assert.match(JSON.parse(call.options.body).id, /^rota-[a-f0-9]{32}$/); assert.doesNotMatch(call.options.body, /private@example.com|52998224725/); }
  assert.notEqual(calls[0].options.body, calls[1].options.body);
  assert.equal((await receiveNexumWebhook(event('notification_a', 'PAID'))).duplicate, true); assert.equal(calls.length, 2);
}));

test('eventos inválidos, outros pedidos, reembolsos e falhas não disparam venda', async () => setup(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected notification'); };
  for (const body of [event('bad_ref', 'REFUNDED'), event('bad_fail', 'FAILED'), { ...event('bad_paid', 'PAID'), paid: false }, { ...event('bad_id'), tx_id: 'another' }, { ...event('bad_event'), event: 'withdraw.status_changed' }]) assert.equal((await receiveNexumWebhook(body)).ignored, true);
  const wrongAmount = event('wrong_amount'); wrongAmount.transaction.amount = 1; assert.equal((await receiveNexumWebhook(wrongAmount)).ignored, true);
  const wrongOrder = event('wrong_order'); wrongOrder.transaction.external_reference = 'other-product'; assert.equal((await receiveNexumWebhook(wrongOrder)).ignored, true);
}));

test('concorrência não duplica aviso e falha de entrega permite nova tentativa', async () => setup(async () => {
  let count = 0; globalThis.fetch = async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ success: true }); };
  await Promise.all([receiveNexumWebhook(event('parallel')), receiveNexumWebhook(event('parallel'))]); assert.equal(count, 1);
  globalThis.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(receiveNexumWebhook(event('retry')), error => error.status === 503);
  globalThis.fetch = async () => Response.json({ success: true }); assert.equal((await receiveNexumWebhook(event('retry'))).ok, true);
}));

test('rota de webhook autentica antes de processar e aceita origem do provedor', async () => setup(async originalFetch => {
  const server = createServer(handler).listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
  let sent = 0; globalThis.fetch = async (url, options) => { if (String(url).startsWith('https://api.pushcut.io/')) { sent++; return Response.json({ ok: true }); } return originalFetch(url, options); };
  const post = (token, body = event('route')) => originalFetch(base + '/api/webhooks/nexum', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://api.nexumpaybot.com', 'X-Webhook-Token': token }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('wrong')).status, 401); assert.equal(sent, 0);
    assert.equal((await originalFetch(base + '/api/webhooks/nexum')).status, 405);
    assert.equal((await post('test-webhook-secret')).status, 200); assert.equal(sent, 1);
  } finally { server.close(); }
}));
