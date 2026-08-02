// src/environments/environment.ts
// Dev usando recursos reais (Cloud)
import type { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: false,
  stage: false,
  env: 'dev-real',
  useEmulators: false,
  emulators: undefined,

  firebase: {
    apiKey: 'AIzaSyAtk-mc6oVZOqu9u7_2KIpk570q8O8Jrl0',
    authDomain: 'entretenimento-sexual.firebaseapp.com',
    databaseURL: 'https://entretenimento-sexual-default-rtdb.firebaseio.com',
    projectId: 'entretenimento-sexual',
    storageBucket: 'entretenimento-sexual.appspot.com',
    messagingSenderId: '668950141209',
    appId: '1:668950141209:web:73e27794c51e493cf44d88',
    measurementId: 'G-GWTPJVK044',
  },

  apiEndpoint: 'http://localhost:3000',
  enableDebugTools: true,

  privacyLogging: {
    enabled: true,
    allowSensitiveConsoleData: false,
    allowCacheTrace: false,
    includeStackTrace: false,
  },

  monitoring: {
    sentry: {
      enabled: false,
      dsn: undefined,
      tracesSampleRate: 0,
    },
  },

  appCheck: {
    // Dev-real usa o mesmo app Firebase e as mesmas Functions protegidas.
    // Localhost precisa estar autorizado no provedor reCAPTCHA/App Check.
    enabled: true,
    provider: 'reCaptchaV3',
    siteKey: '6LcL3k8tAAAAALjZRaY4sQiD40xSnkNqtXVed-dI',
  },

  // 🔐 Integrações externas
  integrations: {
    virusTotal: {
      enabled: false,
      // ⚠️ Só para DESENVOLVIMENTO local. Em produção NÃO exponha a chave no front.
      apiKey: undefined,
      useProxy: false, // direto no browser (pode falhar por CORS)
      region: 'us-central1',
    },
  },

  features: {
    enforceEmailVerified: false,
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: [
      '/dashboard/chat',
      '/dashboard/featured-profiles',
    ],
    subscriberExperiencesPreview: false,
    communityPreview: false,
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
};
