import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../src/assets/firebase-messaging-sw.js', import.meta.url), 'utf8');
const binding = 'binding_12345678901234567890';
const eventId = 'a'.repeat(64);

function harness(initialBinding = binding) {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const focused = [];
  let active = initialBinding;
  let clients = [];
  const self = {
    location: { origin: 'https://example.test', href: 'https://example.test/assets/firebase-messaging-sw.js' },
    addEventListener: (name, handler) => handlers.set(name, handler),
    clients: { matchAll: async () => clients, openWindow: async url => opened.push(url) },
    registration: { showNotification: async (title, options) => shown.push({ title, options }), getNotifications: async () => [] },
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({ get: () => ({ result: { id: active } }) }) };
        queueMicrotask(() => tx.oncomplete());
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  runInNewContext(source, { self, indexedDB, URL, importScripts() {} });
  async function dispatch(name, extra) {
    let pending;
    handlers.get(name)({ ...extra, stopImmediatePropagation() {}, waitUntil(p) { pending = p; } });
    await pending;
  }
  return { shown, opened, focused, dispatch, setBinding: id => { active = id; },
    setClients: value => { clients = value; } };
}

test('external content is neutral and duplicates use the same tag', async () => {
  const h = harness();
  const payload = { data: { webPushBinding: binding, webPushEventId: eventId, title: 'private', body: 'private', route: '/perfil/private' } };
  await h.dispatch('push', { data: { json: () => payload } });
  await h.dispatch('push', { data: { json: () => payload } });
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[0].title, 'Entretenimento');
  assert.equal(h.shown[0].options.body, 'Você tem uma nova notificação.');
  assert.equal(h.shown[0].options.tag, h.shown[1].options.tag);
  assert.equal(h.shown[0].options.renotify, false);
  assert.equal(h.shown[0].options.data.route, undefined);
});
test('rejects stale binding and legacy payload without event identity', async () => {
  const h = harness();
  for (const data of [{ webPushBinding: 'other_binding_123456789', webPushEventId: eventId }, { webPushBinding: binding }]) {
    await h.dispatch('push', { data: { json: () => ({ data }) } });
  }
  assert.equal(h.shown.length, 0);
});
test('click rejects missing or stale binding, routes valid alert only to Central', async () => {
  const h = harness();
  for (const data of [{ route: '/perfil/old' }, { webPushBinding: 'other_binding_123456789' }]) {
    await h.dispatch('notificationclick', { notification: { data, close() {} } });
  }
  assert.equal(h.opened.length, 0);
  await h.dispatch('notificationclick', { notification: { data: { webPushBinding: binding, route: '/perfil/old' }, close() {} } });
  assert.deepEqual(h.opened, ['https://example.test/notificacoes']);
});
test('does not repurpose an unrelated tab', async () => {
  const h = harness();
  h.setClients([{ url: 'https://example.test/chat', navigate: async () => { throw Error('must not navigate'); } }]);
  await h.dispatch('notificationclick', { notification: { data: { webPushBinding: binding }, close() {} } });
  assert.deepEqual(h.opened, ['https://example.test/notificacoes']);
});
