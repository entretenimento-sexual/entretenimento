/* src/assets/firebase-messaging-sw.js
 *
 * Worker dedicado ao Firebase Cloud Messaging.
 *
 * A configuração pública do projeto Firebase é recebida na URL de registro
 * para que o mesmo artefato funcione em dev-real, staging e produção.
 * O aviso carrega um identificador opaco de vínculo, separado da conta e do token FCM.
 */

/* global firebase, importScripts, self */

'use strict';

const NOTIFICATION_FALLBACK_ROUTE = '/notificacoes';
const PRIVATE_PUSH_TITLE = 'Entretenimento';
const PRIVATE_PUSH_BODY = 'Você tem uma nova notificação.';
const DELIVERY_DATABASE = 'entretenimento-web-push';
const DELIVERY_STORE = 'delivery';
const DELIVERY_KEY = 'active';

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));

function readBindingId() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DELIVERY_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DELIVERY_STORE);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(DELIVERY_STORE, 'readonly');
      const binding = tx.objectStore(DELIVERY_STORE).get(DELIVERY_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(binding.result?.id ?? null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    };
  }).catch(() => null);
}

async function displayPush(event) {
  const data = event.data?.json()?.data;
  const id = data?.webPushBinding;
  if (!validBinding(id)) return;
  const eventId = data.webPushEventId;
  if (typeof eventId !== 'string' || !/^[a-f0-9]{64}$/.test(eventId)) return;

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some((client) => client.visibilityState === 'visible')) return;
  if (await readBindingId() !== id) return;

  // A stable tag replaces the same visible alert without re-alerting.
  // The worker independently enforces neutral content and destination.
  await self.registration.showNotification(PRIVATE_PUSH_TITLE, {
    body: PRIVATE_PUSH_BODY,
    tag: `push:${id}:${eventId}`,
    renotify: false,
    data: { webPushBinding: id },
  });
  // Um logout pode ter confirmado enquanto showNotification aguardava o browser.
  if (await readBindingId() !== id) {
    for (const notification of await self.registration.getNotifications()) {
      if (notification.data?.webPushBinding === id) notification.close();
    }
  }
}

// Intercepta também payloads antigos que o SDK exibiria automaticamente.
self.addEventListener('push', (event) => {
  event.stopImmediatePropagation();
  event.waitUntil(displayPush(event).catch(() => undefined));
});

function validBinding(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

async function focusOrOpenNotificationRoute(binding) {
  const targetUrl = new URL(NOTIFICATION_FALLBACK_ROUTE, self.location.origin);
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const sameOriginClients = windowClients.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  const exactClient = sameOriginClients.find((client) => {
    try {
      return new URL(client.url).href === targetUrl.href;
    } catch {
      return false;
    }
  });

  if (await readBindingId() !== binding) return;
  if (exactClient) {
    return exactClient.focus();
  }

  // Do not navigate an arbitrary existing tab: it may represent another
  // independently authenticated session. Open only the generic Central.
  if (await readBindingId() !== binding) return;
  return self.clients.openWindow(targetUrl.href);
}

// O handler precisa ser registrado antes do SDK do Firebase. Assim, o clique
// sempre passa pela validação same-origin abaixo antes de qualquer handler
// automático do Messaging compat.
self.addEventListener('notificationclick', (event) => {
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  event.notification.close();

  const binding = event.notification.data?.webPushBinding;
  event.waitUntil((async () => {
    if (!validBinding(binding) || await readBindingId() !== binding) return;
    await focusOrOpenNotificationRoute(binding);
  })());
});

importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js'
);
importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js'
);

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  storageBucket: params.get('storageBucket') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

const requiredKeys = [
  'apiKey',
  'projectId',
  'messagingSenderId',
  'appId',
];

const configured = requiredKeys.every((key) =>
  String(firebaseConfig[key] || '').trim()
);

if (configured) {
  firebase.initializeApp(firebaseConfig);

  // Mantém o lifecycle de inscrição do SDK. A exibição passa pelo handler acima.
  firebase.messaging();
}
