import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import handler from '../api/index.js';
import { PRICE, configured, paymentAvailable, validCpf, customerFrom, createCharge, getCharge, signOrder, verifyOrder, reviewMode } from '../lib/checkout.js';

const input = { name: 'João da Conceição', email: 'aluno@example.com', emailConfirmation: 'aluno@example.com', document: '52998224725', phone: '11999999999', accepted: true, requestId: '10000000-0000-4000-8000-000000000001' };
const external = 'rota-nexum-247-' + input.requestId;
const pending = { ok: true, tx_id: 'nexum_test', status: 'PENDING', amount: 247, external_reference: external, qr_code_text: '000201TEST', qr_code_base64: 'aGVsbG8=', expires_in_seconds: 86400 };
function credentials() {
  for (const key of ['LOCAL_REVIEW', 'VERCEL', 'VERCEL_ENV', 'ORDER_SIGNING_SECRET', 'NEXUM_ALLOW_LIMIT_TEST']) delete process.env[key];
  process.env.NEXUM_API_CHAT_ID = '1000000000'; process.env.NEXUM_API_CREDENTIAL = 'test-credential-no-live-requests';
}
function tokenFor(id, options = {}) { return signOrder({ id, external_id: external, amount: PRICE, provider: 'nexum', ...options }); }
async function withFetch(mock, run) { const original = globalThis.fetch; globalThis.fetch = mock; try { await run(); } finally { globalThis.fetch = original; } }
async function withApi(run) {
  const server = createServer(handler).listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run('http://127.0.0.1:' + server.address().port); } finally { server.close(); }
}

test('valida CPF, confirmação de e-mail, DDD e consentimento', () => {
  assert.equal(validCpf(input.document), true); assert.equal(validCpf('11111111111'), false); assert.equal(validCpf('52998224724'), false);
  assert.throws(() => customerFrom({ ...input, emailConfirmation: 'outro@example.com' }), /iguais/);
  assert.throws(() => customerFrom({ ...input, accepted: false }), /prazo/);
  assert.throws(() => customerFrom({ ...input, phone: '123' }), /celular/);
  assert.throws(() => customerFrom({ ...input, phone: '78999999999' }), /DDD não é válido/);
});

test('sessões recusam adulteração, expiração e mudança de valor ou gateway', () => {
  credentials(); const token = tokenFor('session_test'); assert.equal(verifyOrder(token).amount, 247);
  assert.throws(() => verifyOrder(token + 'x'), /inválida/);
  const expiredPayload = Buffer.from(JSON.stringify({ id: 'test', order: external, provider: 'nexum', amount: 247, exp: 1 })).toString('base64url');
  const expired = expiredPayload + '.' + createHmac('sha256', process.env.NEXUM_API_CREDENTIAL).update(expiredPayload).digest('base64url');
  assert.throws(() => verifyOrder(expired), /expirou/);
  assert.throws(() => verifyOrder(tokenFor('wrong_amount', { amount: 1 })), /Valor/);
  const parts = token.split('.'); const payload = JSON.parse(Buffer.from(parts[0], 'base64url')); payload.provider = 'atlas';
  assert.throws(() => verifyOrder(Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + parts[1]), /inválida/);
});

test('contrato Nexum: 247 reais, nome normalizado, origem, autenticação e idempotência', async () => {
  credentials(); const captured = [];
  await withFetch(async (url, options) => { captured.push({ url, options }); return Response.json(pending); }, async () => {
    const first = await createCharge({ ...input, amount: 1 }); await createCharge(input);
    assert.equal(captured[0].url, 'https://api.nexumpaybot.com/api/public/pix/create');
    assert.deepEqual(JSON.parse(captured[0].options.body), { amount: 247, generatedName: 'Joao da Conceicao', generatedEmail: input.email, generatedDocument: input.document, externalReference: external });
    assert.equal(captured[0].options.headers.Origin, 'https://nexumpaybot.com');
    assert.equal(captured[0].options.headers['X-API-Chat-Id'], process.env.NEXUM_API_CHAT_ID);
    assert.equal(captured[0].options.headers['X-API-Credential'], process.env.NEXUM_API_CREDENTIAL);
    assert.equal(captured[0].options.headers['Idempotency-Key'], captured[1].options.headers['Idempotency-Key']);
    assert.equal(first.amount, 247); assert.equal(first.pix.image, 'data:image/png;base64,aGVsbG8='); assert.ok(Date.parse(first.pix.expiresAt) > Date.now());
    assert.doesNotMatch(JSON.stringify(first), /aluno@example.com|52998224725|test-credential/);
    assert.equal((await getCharge(first.token)).status, 'pending'); assert.equal(captured.length, 2);
    assert.ok(first.nextPollAt > Date.now() + 29000);
  });
});

test('consulta valida ID, valor, referência e status antes de confirmar', async () => {
  credentials(); let data; let calledUrl;
  await withFetch(async url => { calledUrl = url; return Response.json(data); }, async () => {
    for (const [name, bad] of Object.entries({ id: { tx_id: 'other' }, amount: { amount: 1 }, reference: { external_reference: 'other' }, status: { status: 'NOT_A_STATUS' }, ok: { ok: false } })) {
      const id = 'invalid_' + name; data = { ...pending, tx_id: id, status: 'PAID', ...bad }; await assert.rejects(getCharge(tokenFor(id)));
    }
    data = { ok: true, tx_id: 'paid_valid', amount: 247, status: 'PAID' };
    assert.equal((await getCharge(tokenFor(data.tx_id))).status, 'paid');
    assert.equal(calledUrl, 'https://api.nexumpaybot.com/api/public/pix/status/paid_valid');
  });
});

test('status documentados: pago, pendente, reembolso, cancelamento e expiração', async () => {
  credentials(); let data;
  await withFetch(async () => Response.json(data), async () => {
    for (const [status, expected] of Object.entries({ APPROVED: 'paid', COMPLETED: 'paid', SUCCESS: 'paid', CONFIRMED: 'paid', COMPLETO: 'paid', PROCESSING: 'pending', UNKNOWN: 'pending', RESERVED: 'pending', REJECTED: 'failed', REFUNDED: 'refunded', CANCELED: 'failed', EXPIRED: 'expired' })) {
      const id = 'status_' + status; data = { ok: true, tx_id: id, amount: 247, status };
      const result = await getCharge(tokenFor(id)); assert.equal(result.status, expected);
      if (status === 'REFUNDED') assert.equal(result.refunded, 247);
    }
  });
});

test('consulta respeita 30 segundos e compartilha chamadas simultâneas', async () => {
  credentials(); let count = 0; const id = 'poll_guard'; const token = tokenFor(id);
  await withFetch(async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ ok: true, tx_id: id, amount: 247, status: 'PAID' }); }, async () => {
    const [first, second] = await Promise.all([getCharge(token), getCharge(token)]);
    assert.equal(first.status, 'paid'); assert.equal(second.status, 'paid'); assert.equal(count, 1);
    await getCharge(first.token); await getCharge(token); assert.equal(count, 1);
  });
});

test('202 em reconciliação mantém pedido consultável sem inventar QR ou aprovação', async () => {
  credentials();
  await withFetch(async () => Response.json({ ok: true, tx_id: 'processing_202', amount: 247, status: 'PROCESSING', reconciliation_required: true }, { status: 202 }), async () => {
    const result = await createCharge(input); assert.equal(result.status, 'pending'); assert.equal(result.pix, undefined);
    assert.equal(verifyOrder(result.token).id, 'processing_202'); assert.equal((await getCharge(result.token)).status, 'pending');
  });
});

test('falha permite nova tentativa, timeout preserva a chave e logs não vazam dados', async () => {
  credentials(); const originalWarn = console.warn; const warnings = []; console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await withFetch(async () => Response.json({ ...pending, status: 'FAILED' }), async () => { await assert.rejects(createCharge(input), error => error.code === 'PIX_CREATION_FAILED' && error.retryWithNewAttempt === true); });
    await withFetch(async () => { throw new TypeError('secret upstream error'); }, async () => { await assert.rejects(createCharge(input), error => error.status === 503 && !error.retryWithNewAttempt); });
    await withFetch(async () => Response.json({ ok: false, message: 'aluno@example.com 52998224725' }, { status: 403 }), async () => { await assert.rejects(createCharge(input)); });
    assert.match(warnings.join('\n'), /authentication_or_origin/); assert.doesNotMatch(warnings.join('\n'), /aluno@example.com|52998224725|test-credential|secret upstream/);
    let attempted = false;
    await withFetch(async () => { attempted = true; throw Error(); }, async () => { await assert.rejects(createCharge({ ...input, phone: '78999999999' }), /DDD/); assert.equal(attempted, false); });
  } finally { console.warn = originalWarn; }
});

test('429 preserva Retry-After e resposta sem JSON não expõe conteúdo', async () => {
  credentials();
  await withFetch(async () => Response.json({ ok: false }, { status: 429, headers: { 'Retry-After': '90' } }), async () => { await assert.rejects(getCharge(tokenFor('limited')), error => error.status === 429 && error.retryAfter === 90); });
  await withFetch(async () => new Response('<html>private upstream data</html>', { status: 502 }), async () => { await assert.rejects(createCharge(input), error => error.status === 503 && !error.message.includes('private')); });
});

test('pedidos Atlas existentes continuam consultáveis por 397', async () => {
  credentials(); process.env.ATLAS_SECRET_KEY = 'legacy-test-key'; const oldOrder = 'rota-' + input.requestId;
  const payload = Buffer.from(JSON.stringify({ id: 'atlas_old', order: oldOrder, exp: Date.now() + 86400000 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', process.env.ATLAS_SECRET_KEY).update(payload).digest('base64url');
  await withFetch(async (url, options) => {
    assert.equal(url, 'https://atlaspags.com/api/v1/charges/atlas_old'); assert.notEqual(options.method, 'POST');
    return Response.json({ id: 'atlas_old', external_id: oldOrder, amount: 397, method: 'pix', metadata: { product: 'rota-black-2026' }, livemode: true, status: 'paid' });
  }, async () => { const result = await getCharge(token); assert.equal(result.status, 'paid'); assert.equal(result.amount, 397); });
});

test('sem as duas credenciais Nexum bloqueia; simulação e prévias não abrem em produção', async () => {
  credentials(); delete process.env.NEXUM_API_CHAT_ID; assert.equal(configured(), false);
  process.env.LOCAL_REVIEW = '1'; process.env.VERCEL = '1'; process.env.VERCEL_ENV = 'production'; assert.equal(reviewMode(), false);
  try { await withApi(async base => {
    const config = await (await fetch(base + '/api/config')).json(); assert.equal(config.available, false); assert.equal(config.price, 247);
    const post = (path, data) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post('/api/checkout', input)).status, 503);
    assert.equal((await post('/api/review/pay', {})).status, 404); assert.equal((await fetch(base + '/api/intro')).status, 401);
    assert.equal((await fetch(base + '/api/review-thanks')).status, 404); assert.equal((await fetch(base + '/api/review-pdf')).status, 404);
    assert.equal((await fetch(base + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wrong.test' }, body: JSON.stringify(input) })).status, 403);
  }); } finally { credentials(); }
});

test('Nexum: PDF protegido e consulta compartilhada com a página de obrigado', async () => {
  credentials(); const original = globalThis.fetch; let count = 0;
  globalThis.fetch = async (url, options) => { if (!String(url).startsWith('https://api.nexumpaybot.com/')) return original(url, options); count++; return Response.json({ ok: true, tx_id: 'paid_pdf', amount: 247, status: 'PAID' }); };
  try { await withApi(async base => {
    const response = await original(base + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenFor('paid_pdf') }) });
    const result = await response.json(); assert.equal(result.status, 'paid');
    const pdf = await original(base + '/api/intro', { headers: { Authorization: 'Bearer ' + result.token } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF'); assert.equal(count, 1);
    const unpaid = tokenFor('unpaid_pdf', { checked: { status: 'pending', refunded: 0, at: Date.now() } });
    assert.equal((await original(base + '/api/intro', { headers: { Authorization: 'Bearer ' + unpaid } })).status, 403);
  }); } finally { globalThis.fetch = original; }
});

test('revisão local completa: criação idempotente, aprovação e PDF', async () => {
  credentials(); process.env.LOCAL_REVIEW = '1';
  try { await withApi(async base => {
    const post = (path, data) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const created = await (await post('/api/checkout', input)).json(); assert.equal(created.status, 'pending'); assert.equal(created.amount, 247);
    assert.equal((await (await post('/api/checkout', input)).json()).id, created.id);
    assert.equal((await fetch(base + '/api/intro', { headers: { Authorization: 'Bearer ' + created.token } })).status, 403);
    assert.equal((await post('/api/review/pay', { token: created.token })).status, 200);
    assert.equal((await (await post('/api/order', { token: created.token })).json()).status, 'paid');
    assert.equal((await fetch(base + '/api/intro', { headers: { Authorization: 'Bearer ' + created.token } })).status, 200);
  }); } finally { delete process.env.LOCAL_REVIEW; }
});

test('todas as telas exibem o preço novo e os blocos removidos não voltam', async () => {
  for (const name of ['index.html', 'checkout.html', 'pagamento.html', 'obrigado.html', 'termos.html']) {
    const html = await readFile(new URL('../public/' + name, import.meta.url), 'utf8'); assert.match(html, /R\$ 247/); assert.doesNotMatch(html, /R\$ 397/);
  }
  assert.doesNotMatch(await readFile(new URL('../public/pagamento.html', import.meta.url), 'utf8'), /class="delivery-note"|class="help-box"/);
});

test('disponibilidade valida credenciais e limites sem criar cobrança nem expor a conta', async () => {
  credentials(); let count = 0;
  await withFetch(async (url, options) => {
    count++; assert.equal(url, 'https://api.nexumpaybot.com/api/public/auth/validate'); assert.notEqual(options.method, 'POST');
    return Response.json({ ok: true, authenticated: true, account: { chat_id: process.env.NEXUM_API_CHAT_ID, status: true, min_deposit: 5, max_deposit: 500 } });
  }, async () => { assert.equal(await paymentAvailable(), true); assert.equal(await paymentAvailable(), true); assert.equal(count, 1); });
});

test('conta autenticada com teto de 200 reais não habilita cobrança de 247', async () => {
  credentials(); const now = Date.now; const afterCache = now() + 60000; Date.now = () => afterCache;
  try {
    await withFetch(async () => Response.json({ ok: true, authenticated: true, account: { chat_id: process.env.NEXUM_API_CHAT_ID, status: true, min_deposit: 10, max_deposit: 200 } }), async () => { assert.equal(await paymentAvailable(), false); });
  } finally { Date.now = now; }
});

test('liberação de teste permite tentar acima do limite, mas exige autenticação e conta ativa', async () => {
  credentials(); process.env.NEXUM_ALLOW_LIMIT_TEST = '1';
  const originalNow = Date.now; let now = originalNow() + 120000; Date.now = () => now;
  let data = { ok: true, authenticated: true, account: { chat_id: process.env.NEXUM_API_CHAT_ID, status: true, min_deposit: 10, max_deposit: 200 } };
  try {
    await withFetch(async () => Response.json(data), async () => {
      assert.equal(await paymentAvailable(), true);
      now += 31000; data = { ...data, authenticated: false }; assert.equal(await paymentAvailable(), false);
      now += 31000; data = { ...data, authenticated: true, account: { ...data.account, status: false } }; assert.equal(await paymentAvailable(), false);
      now += 31000; data = { ...data, account: { ...data.account, status: true, chat_id: 'another-account' } }; assert.equal(await paymentAvailable(), false);
    });
  } finally { Date.now = originalNow; delete process.env.NEXUM_ALLOW_LIMIT_TEST; }
});
