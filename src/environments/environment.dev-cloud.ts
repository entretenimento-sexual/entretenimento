// src/environments/environment.dev-cloud.ts
// -----------------------------------------------------------------------------
// DESENVOLVIMENTO CONECTADO À CLOUD — USO EXPLÍCITO
// -----------------------------------------------------------------------------
// Este ambiente acessa o projeto Firebase cloud `entretenimento-sexual`.
// Não deve ser usado pelo comando local padrão e não substitui deploy de
// Functions, Rules, índices ou demais dependências de backend.
//
// O identificador interno permanece `dev-real` por compatibilidade com o
// contrato tipado já usado em telemetria e políticas de runtime. O nome
// operacional explícito desta configuração é `dev-cloud` no angular.json.
// -----------------------------------------------------------------------------

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
    enabled: false,
    provider: 'reCaptchaV3',
    siteKey: 'dev-recaptcha-v3-site-key',
  },

  integrations: {
    virusTotal: {
      enabled: false,
      apiKey: undefined,
      useProxy: false,
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
