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

interface WorkerHarness {
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
  const workerSelf = {
    location: new URL(WORKER_URL),
    clients: {
      matchAll: async () => windowClients,
      openWindow: async (url: string) => {
        openedUrls.push(url);
        return {url};
      },
    },
    addEventListener: (type: string, listener: NotificationClickListener) => {
      listeners.set(type, listener);
    },
  };

  vm.runInNewContext(
    workerSource,
    {
      self: workerSelf,
      URL,
      URLSearchParams,
      console,
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

test('worker navega uma aba same-origin para o deep link válido do FCM', async () => {
  const navigatedUrls: string[] = [];
  let focusCount = 0;
  const client: FakeWindowClient = {
    url: 'https://app.example/dashboard/principal',
    navigate: async (url) => {
      navigatedUrls.push(url);
      client.url = url;
      return client;
    },
    focus: async () => {
      focusCount += 1;
      return client;
    },
  };
  const harness = createWorkerHarness([client]);

  const eventState = await harness.dispatchClick({
    FCM_MSG: {
      data: {
        route: '/comunidades/abc/post/123?origem=push#comentario',
      },
    },
  });

  assert.deepEqual(navigatedUrls, [
    'https://app.example/comunidades/abc/post/123?origem=push#comentario',
  ]);
  assert.equal(focusCount, 1);
  assert.equal(harness.openedUrls.length, 0);
  assert.deepEqual(eventState, {closed: 1, stopped: 1});
});

test('worker rejeita destino externo e usa a Central como fallback', async () => {
  const navigatedUrls: string[] = [];
  const client: FakeWindowClient = {
    url: 'https://app.example/dashboard/principal',
    navigate: async (url) => {
      navigatedUrls.push(url);
      client.url = url;
      return client;
    },
    focus: async () => client,
  };
  const harness = createWorkerHarness([client]);

  await harness.dispatchClick({route: 'https://evil.example/phish'});

  assert.deepEqual(navigatedUrls, ['https://app.example/notificacoes']);
  assert.equal(harness.openedUrls.length, 0);
});

test('worker abre a Central quando não existe rota nem aba reutilizável', async () => {
  const harness = createWorkerHarness([]);

  await harness.dispatchClick({});

  assert.deepEqual(harness.openedUrls, [
    'https://app.example/notificacoes',
  ]);
});
