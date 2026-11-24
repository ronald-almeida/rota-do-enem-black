import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../lib/webhooks.js';
import { createNotificationStore } from '../lib/notification-store.js';
import { fakeBlob } from './fixtures/notification-store.mjs';

function setup() {
  process.env.PUSHCUT_PIX_PENDING_URL = 'https://api.pushcut.io/test-secret/notifications/pending';
  process.env.PUSHCUT_PIX_PAID_URL = 'https://api.pushcut.io/test-secret/notifications/paid';
}
test('20 instâncias concorrentes e uma reinicialização enviam só um aviso por status', async () => {
  setup(); const blob = fakeBlob(); const sent = [];
  const sender = async (url, options) => { sent.push({ url, body: options.body }); return Response.json({ ok: true }); };
  const workers = Array.from({ length: 20 }, () => createNotifier(createNotificationStore(blob), sender));
  await Promise.all(workers.map(send => send('atlas', 'txn_parallel', 'pending')));
  assert.equal(sent.length, 1);
  await createNotifier(createNotificationStore(blob), sender)('atlas', 'txn_parallel', 'pending'); assert.equal(sent.length, 1);
  await Promise.all(workers.map(send => send('atlas', 'txn_parallel', 'paid'))); assert.equal(sent.length, 2);
  assert.notEqual(sent[0].body, sent[1].body);
});
test('falha de armazenamento impede envio sem proteção', async () => {
  setup(); let sent = 0;
  const store = { async claim() { throw Error('storage outage'); } };
  await assert.rejects(createNotifier(store, async () => { sent++; })('atlas', 'no_storage', 'paid'), error => error.status === 503);
  assert.equal(sent, 0);
});
test('timeout, erro 5xx e perda da confirmação de gravação não repetem a notificação', async () => {
  setup();
  for (const mode of ['timeout', 'server_error', 'save_failed']) {
    const blob = fakeBlob(); const store = createNotificationStore(blob); let sent = 0;
    const sender = async () => { sent++; if (mode === 'timeout') throw Error('network timeout after send'); return new Response('', { status: mode === 'server_error' ? 502 : 200 }); };
    const faulty = mode === 'save_failed' ? { claim: store.claim, async finish() { throw Error('storage outage after delivery'); } } : store;
    await createNotifier(faulty, sender)('atlas', mode, 'paid').catch(error => assert.equal(error.status, 503));
    const replay = await createNotifier(createNotificationStore(blob), sender)('atlas', mode, 'paid');
    assert.equal(replay.duplicate, true); assert.equal(sent, 1);
  }
});
test('rejeição explícita permite uma nova tentativa única com o mesmo ID', async () => {
  setup(); const blob = fakeBlob(); const sent = []; let limited = true;
  const sender = async (_, options) => { sent.push(options.body); return new Response('', { status: limited ? 429 : 200 }); };
  await assert.rejects(createNotifier(createNotificationStore(blob), sender)('nexum', 'limited', 'paid'), error => error.status === 503);
  limited = false;
  await Promise.all(Array.from({ length: 10 }, () => createNotifier(createNotificationStore(blob), sender)('nexum', 'limited', 'paid')));
  assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]);
});

test('instância que observou um envio em andamento permite retentativa após rejeição', async () => {
  setup(); const blob = fakeBlob(); let sent = 0;
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const sender = async () => {
    sent++;
    if (sent === 1) { started.resolve(); await release.promise; return new Response('', { status: 429 }); }
    return Response.json({ ok: true });
  };
  const first = createNotifier(createNotificationStore(blob), sender);
  const second = createNotifier(createNotificationStore(blob), sender);
  const rejected = assert.rejects(first('nexum', 'retry_inflight', 'paid'), error => error.status === 503);
  await started.promise;
  assert.equal((await second('nexum', 'retry_inflight', 'paid')).duplicate, true);
  release.resolve(); await rejected;
  assert.deepEqual(await second('nexum', 'retry_inflight', 'paid'), { ok: true });
  assert.equal(sent, 2);
});
