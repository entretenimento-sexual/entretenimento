// src/environments/environment.staging.ts
// Ambiente de STAGING
// - Sem emuladores
// - Debug tools ligadas
// - Flags mais rígidas
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
    // ✅ CORRIGIDO: bucket usa .appspot.com
    storageBucket: 'entretenimento-staging.appspot.com',
    messagingSenderId: '918083447157',
    appId: '1:918083447157:web:6a2841d918b0348a3f8b3c',
    // measurementId: 'G-XXXXXXXXXX', // adicione se usar Analytics no stage
  },

  apiEndpoint: 'https://api.staging.seuprojeto.com',
  enableDebugTools: true,

  integrations: {
    virusTotal: {
      enabled: false,
      apiKey: undefined,
      useProxy: true,
      region: 'us-central1',
    }
  },

  appCheck: {
    enabled: true,
    provider: 'reCaptchaV3',
    siteKey: 'staging-recaptcha-v3-site-key',
  },

  features: {
    enforceEmailVerified: true, // exigir verificação
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: ['/dashboard', '/chat', '/friends'],
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
};
