/* src/assets/firebase-messaging-sw.js
 *
 * Worker dedicado ao Firebase Cloud Messaging.
 *
 * A configuração pública do projeto Firebase é recebida na URL de registro
 * para que o mesmo artefato funcione em dev-real, staging e produção.
 * Nenhuma VAPID key, token FCM ou identificador de usuário é enviado ao worker.
 */

/* global firebase, importScripts */

'use strict';

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
