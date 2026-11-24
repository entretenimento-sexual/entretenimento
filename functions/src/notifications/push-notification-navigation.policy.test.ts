import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  buildPushNotificationNavigationData,
  normalizePushNotificationRoute,
} from './push-notification-navigation.policy';

interface FakeWindowClient {
  url: string;
  focus: () => Promise<FakeWindowClient>;
  navigate?: (url: string) => Promise<FakeWindowClient | null>;
}

interface FakeNotificationClickEvent {
  notification: {
    data: unknown;
    close: () => void;
  };
  stopImmediatePropagation: () => void;
  waitUntil: (promise: Promise<unknown>) => void;
}

type NotificationClickListener = (event: FakeNotificationClickEvent) => void;

interface FakePushEvent {
  data: { json: () => unknown };
  stopImmediatePropagation: () => void;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface WorkerHarness {
  dispatchPush: (data: unknown) => Promise<void>;
  setBinding: (id: string | null) => Promise<void>;
  shown: string[];
  dispatchClick: (data: unknown) => Promise<{
    closed: number;
    stopped: number;
  }>;
  openedUrls: string[];
}

const WORKER_URL =
  'https://app.example/assets/firebase-messaging-sw.js' +
  '?apiKey=a&projectId=p&messagingSenderId=s&appId=i';

function createWorkerHarness(windowClients: FakeWindowClient[]): WorkerHarness {
  const workerPath = resolve(
    __dirname,
    '../../../src/assets/firebase-messaging-sw.js'
  );
  const workerSource = readFileSync(workerPath, 'utf8');
  const listeners = new Map<string, NotificationClickListener>();
  const openedUrls: string[] = [];
  const shown: string[] = [];
  const pushListeners = new Map<string, (event: FakePushEvent) => void>();
  let bindingId: string | null = null;
  const indexedDB = {
    open: () => {
      const request = {
        onsuccess: () => undefined,
        result: {
          close: () => undefined,
          transaction: () => {
            const transaction = {
              oncomplete: () => undefined,
              objectStore: () => ({
                get: () => ({ result: bindingId ? { id: bindingId } : undefined }),
              }),
            };
            queueMicrotask(() => transaction.oncomplete());
            return transaction;
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  const workerSelf = {
    location: new URL(WORKER_URL),
    clients: {
      matchAll: async () => windowClients,
      openWindow: async (url: string) => {
        openedUrls.push(url);
        return {url};
      },
    },
    registration: {
      showNotification: async (title: string) => { shown.push(title); },
      getNotifications: async () => [],
    },
    addEventListener: (type: string, listener: unknown) => {
      if (type === 'push') pushListeners.set(type, listener as (event: FakePushEvent) => void);
      if (type === 'notificationclick') listeners.set(type, listener as NotificationClickListener);
    },
  };

  vm.runInNewContext(
    workerSource,
    {
      self: workerSelf,
      URL,
      URLSearchParams,
      console,
      indexedDB,
      importScripts: () => {
        assert.equal(
          listeners.has('notificationclick'),
          true,
          'notificationclick deve ser registrado antes do Firebase compat'
        );
      },
      firebase: {
        initializeApp: () => undefined,
        messaging: () => ({}),
      },
    },
    {filename: workerPath}
  );

  return {
    openedUrls,
    shown,
    setBinding: async (id) => { bindingId = id; },
    dispatchPush: async (data) => {
      const listener = pushListeners.get('push');
      assert.ok(listener);
      let pending: Promise<unknown> | null = null;
      let stopped = false;
      listener({
        data: { json: () => data },
        stopImmediatePropagation: () => { stopped = true; },
        waitUntil: (promise) => { pending = promise; },
      });
      assert.ok(stopped, 'worker deve impedir exibição automática pelo SDK');
      assert.ok(pending);
      await pending;
    },
    dispatchClick: async (data: unknown) => {
      const listener = listeners.get('notificationclick');
      assert.ok(listener, 'worker deve registrar notificationclick');

      let closed = 0;
      let stopped = 0;
      let pending: Promise<unknown> | null = null;

      listener({
        notification: {
          data,
          close: () => {
            closed += 1;
          },
        },
        stopImmediatePropagation: () => {
          stopped += 1;
        },
        waitUntil: (promise) => {
          pending = Promise.resolve(promise);
        },
      });

      assert.ok(pending, 'worker deve manter o clique vivo com waitUntil');
      await pending;

      return {closed, stopped};
    },
  };
}

test('backend propaga somente rota interna normalizada no data do FCM', () => {
  assert.deepEqual(
    buildPushNotificationNavigationData(
      '/comunidades/abc/../def?origem=push#comentario'
    ),
    {route: '/comunidades/def?origem=push#comentario'}
  );

  assert.equal(
    buildPushNotificationNavigationData('https://evil.example/phish'),
    null
  );
  assert.equal(buildPushNotificationNavigationData('//evil.example/phish'), null);
  assert.equal(buildPushNotificationNavigationData('/\\evil.example/phish'), null);
  assert.equal(normalizePushNotificationRoute('javascript:alert(1)'), null);
});

test('backend corrige rota legada de mensagem de Sala com contexto explícito', () => {
  assert.deepEqual(
    buildPushNotificationNavigationData(
      '/messages/room-123/message-456?origem=push#message',
      {type: 'chat', roomId: 'room-123'}
    ),
    {route: '/chat/rooms'}
  );
});

test('backend preserva convite de Sala e chat direto', () => {
  assert.deepEqual(
    buildPushNotificationNavigationData(
      '/chat/room-invites',
      {type: 'chat', roomId: 'room-123'}
    ),
    {route: '/chat/room-invites'}
  );

  assert.deepEqual(
    buildPushNotificationNavigationData(
      '/chat?userId=user-456',
      {type: 'chat'}
    ),
    {route: '/chat?userId=user-456'}
  );
});

test('backend não reescreve /messages sem contexto completo de Sala', () => {
  assert.deepEqual(
    buildPushNotificationNavigationData('/messages/qualquer-coisa', {
      type: 'chat',
    }),
    {route: '/messages/qualquer-coisa'}
  );

  assert.deepEqual(
    buildPushNotificationNavigationData('/messages/qualquer-coisa', {
      type: 'system',
      roomId: 'room-123',
    }),
    {route: '/messages/qualquer-coisa'}
  );
});

test('worker não redireciona uma aba independente e abre somente a Central com vínculo válido', async () => {
  const client: FakeWindowClient = {
    url: 'https://app.example/dashboard/principal',
    navigate: async () => { throw new Error('Unexpected navigation'); },
    focus: async () => client,
  };
  const harness = createWorkerHarness([client]);
  await harness.setBinding('account-a-binding');
  const state = await harness.dispatchClick({
    webPushBinding: 'account-a-binding', route: '/comunidades/private',
  });
  assert.deepEqual(harness.openedUrls, ['https://app.example/notificacoes']);
  assert.deepEqual(state, {closed: 1, stopped: 1});
});

test('worker rejeita clique legado sem vínculo e rota externa', async () => {
  const harness = createWorkerHarness([]);
  await harness.setBinding('account-a-binding');
  await harness.dispatchClick({ route: 'https://evil.example/phish' });
  await harness.dispatchClick({ FCM_MSG: { data: { route: '/chat' } } });
  assert.deepEqual(harness.openedUrls, []);
});

test('worker abre a Central sem deep link com vínculo confirmado', async () => {
  const harness = createWorkerHarness([]);
  await harness.setBinding('account-a-binding');
  await harness.dispatchClick({ webPushBinding: 'account-a-binding' });
  assert.deepEqual(harness.openedUrls, ['https://app.example/notificacoes']);
});

test('worker descarta push legado e push da sessão anterior após revogação ou troca', async () => {
  const harness = createWorkerHarness([]);
  const payload = (webPushBinding: string) => ({
    data: { webPushBinding, webPushEventId: 'a'.repeat(64), title: 'Entretenimento', body: 'Nova notificação.' },
  });

  await harness.setBinding('account-a-binding');
  await harness.dispatchPush(payload('account-a-binding'));
  assert.deepEqual(harness.shown, ['Entretenimento']);

  await harness.setBinding(null);
  await harness.dispatchPush(payload('account-a-binding'));

  await harness.setBinding('account-b-binding');
  await harness.dispatchPush({ notification: { title: 'Aviso de versão anterior' } });
  await harness.dispatchPush(payload('account-a-binding'));
  await harness.dispatchClick({ webPushBinding: 'account-a-binding' });
  assert.deepEqual(harness.shown, ['Entretenimento']);
  assert.deepEqual(harness.openedUrls, []);

  await harness.dispatchPush(payload('account-b-binding'));
  assert.deepEqual(harness.shown, ['Entretenimento', 'Entretenimento']);
});
