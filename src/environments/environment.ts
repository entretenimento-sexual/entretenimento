// src/environments/environment.ts
// Dev usando recursos reais (Cloud)
export const environment = {
  production: false,
  stage: false,
  env: 'dev-real',

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

  useEmulators: false,
  emulators: undefined,

  appCheck: {
    enabled: false,
    provider: 'reCaptchaV3',
    siteKey: 'dev-recaptcha-v3-site-key',
  },

  // 🔐 Integrações externas
  integrations: {
    virusTotal: {
      enabled: false,
      // ⚠️ Só para DESENVOLVIMENTO local. Em produção NÃO exponha a chave no front.
      apiKey: undefined,
      useProxy: false,           // direto no browser (pode falhar por CORS)
      region: 'us-central1'
    }
  },

  features: {
    enforceEmailVerified: false,
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: ['/dashboard/chat', '/dashboard/featured-profiles'],
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
} as const;
