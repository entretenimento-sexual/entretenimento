// src/environments/environment.prod.ts
// Ambiente de PRODUÇÃO
// - Sem emuladores
// - Políticas rígidas
// - Debug tools desligadas

export const environment = {
  production: true,
  stage: false,
  env: 'production',

  firebase: {
    apiKey: 'AIzaSyAtk-mc6oVZOqu9u7_2KIpk570q8O8Jrl0',
    authDomain: 'entretenimento-sexual.firebaseapp.com',
    databaseURL: 'https://entretenimento-sexual-default-rtdb.firebaseio.com',
    projectId: 'entretenimento-sexual',
    storageBucket: 'entretenimento-sexual.appspot.com',
    messagingSenderId: '668950141209',
    appId: '1:668950141209:web:73e27794c51e493cf44d88',
    measurementId: 'G-GWTPJVK044', // se usar Analytics
  },

  apiEndpoint: 'https://api.seuprojeto.com',
  enableDebugTools: false,

  // Nunca exponha segredos no app web
  virusTotalApiKey: '',

  // Em produção, SEM emuladores
  emulators: undefined,

  appCheck: {
    enabled: true,
    provider: 'reCaptchaV3',         // ou 'reCaptchaEnterprise'
    siteKey: 'prod-recaptcha-v3-site-key',
  },

  features: {
    enforceEmailVerified: true,      // ✅ produção: obrigatório
    showGuestBanner: false,          // normalmente escondemos (opcional)
    restrictedRoutesWhenUnverified: ['/dashboard', '/chat', '/friends', '/upload'],
  },
};
