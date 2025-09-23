// src/environments/environment.staging.ts
// Ambiente de STAGING
// - Próximo de produção (sem emuladores)
// - Debug tools ligadas para testes internos
// - Flags mais rígidas que o dev

export const environment = {
  production: false,
  stage: true,
  env: 'staging',

  firebase: {
    apiKey: 'AIzaSyBt_wLXonmSTqUDruH6ZAlHsA8QvITKdKQ',
    authDomain: 'entretenimento-staging.firebaseapp.com',
    databaseURL: 'https://entretenimento-staging-default-rtdb.firebaseio.com',
    projectId: 'entretenimento-staging',
    storageBucket: 'entretenimento-staging.firebasestorage.app',
    messagingSenderId: '918083447157',
    appId: '1:918083447157:web:6a2841d918b0348a3f8b3c',
    // measurementId opcional em staging, adicione se usar Analytics no stage
    // measurementId: 'G-XXXXXXXXXX',
  },

  apiEndpoint: 'https://api.staging.seuprojeto.com',
  enableDebugTools: true,

  // NÃO coloque chaves secretas no cliente
  virusTotalApiKey: '',

  // Sem emuladores no staging
  emulators: undefined,

  appCheck: {
    enabled: true,             // em staging já vale testar App Check
    provider: 'reCaptchaV3',   // ou 'reCaptchaEnterprise'
    siteKey: 'staging-recaptcha-v3-site-key',
  },

  features: {
    enforceEmailVerified: true,     // ⚠️ staging: exigir verificação
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: ['/dashboard', '/chat', '/friends'],
  },
};
