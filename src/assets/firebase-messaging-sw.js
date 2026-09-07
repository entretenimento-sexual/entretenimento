/* src/assets/firebase-messaging-sw.js
 *
 * Worker dedicado ao Firebase Cloud Messaging.
 *
 * A configuração pública do projeto Firebase é recebida na URL de registro
 * para que o mesmo artefato funcione em dev-real, staging e produção.
 * Nenhuma VAPID key, token FCM ou identificador de usuário é enviado ao worker.
 */

/* global firebase, importScripts, self */

'use strict';

const NOTIFICATION_FALLBACK_ROUTE = '/notificacoes';
const MAX_NOTIFICATION_ROUTE_LENGTH = 2048;

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function normalizeNotificationRoute(value) {
  const route = String(value || '').trim();

  if (
    !route ||
    route.length > MAX_NOTIFICATION_ROUTE_LENGTH ||
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\') ||
    hasControlCharacters(route)
  ) {
    return null;
  }

  try {
    const resolved = new URL(route, self.location.origin);

    if (resolved.origin !== self.location.origin) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

function resolveNotificationRoute(notificationData) {
  const directRoute = notificationData?.route;
  const firebaseRoute = notificationData?.FCM_MSG?.data?.route;

  return (
    normalizeNotificationRoute(directRoute) ||
    normalizeNotificationRoute(firebaseRoute) ||
    NOTIFICATION_FALLBACK_ROUTE
  );
}

async function focusOrOpenNotificationRoute(route) {
  const targetUrl = new URL(route, self.location.origin);
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

  if (exactClient) {
    return exactClient.focus();
  }

  const reusableClient = sameOriginClients[0];

  if (reusableClient && typeof reusableClient.navigate === 'function') {
    try {
      const navigatedClient = await reusableClient.navigate(targetUrl.href);

      if (navigatedClient) {
        return navigatedClient.focus();
      }
    } catch {
      // Se a aba deixou de aceitar navegação, abrimos uma nova janela segura.
    }
  }

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

  const route = resolveNotificationRoute(event.notification.data);
  event.waitUntil(focusOrOpenNotificationRoute(route));
});

importScripts(
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js'
);
importScripts(
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js'
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

  // O backend envia payload "notification". O SDK cuida da exibição em
  // background; não registramos showNotification manual para evitar duplicata.
  firebase.messaging();
}
