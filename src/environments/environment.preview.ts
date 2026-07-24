// src/environments/environment.preview.ts
// Ambiente exclusivo dos previews temporários do Firebase Hosting.
//
// Regras:
// - usa somente o projeto Firebase de staging;
// - nunca conecta aos emuladores locais;
// - não usa recursos do projeto de produção;
// - App Check permanece desativado neste ambiente porque cada PR recebe
//   um domínio temporário diferente. A ativação deve ocorrer apenas quando
//   houver uma chave e uma política próprias para os canais de preview.
import type { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: false,
  stage: true,
  env: 'staging',
  useEmulators: false,
  emulators: undefined,

  firebase: {
    apiKey: 'AIzaSyBt_wLXonmSTqUDruH6ZAlHsA8QvITKdKQ',
    authDomain: 'entretenimento-staging.firebaseapp.com',
    databaseURL: 'https://entretenimento-staging-default-rtdb.firebaseio.com',
    projectId: 'entretenimento-staging',
    storageBucket: 'entretenimento-staging.appspot.com',
    messagingSenderId: '918083447157',
    appId: '1:918083447157:web:6a2841d918b0348a3f8b3c',
  },

  apiEndpoint: 'https://api.staging.seuprojeto.com',
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

  integrations: {
    virusTotal: {
      enabled: false,
      apiKey: undefined,
      useProxy: true,
      region: 'us-central1',
    },
  },

  appCheck: {
    enabled: false,
  },

  features: {
    enforceEmailVerified: true,
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: ['/dashboard', '/chat', '/friends'],
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
};
