//src\environments\environment.dev-emu.ts
// Dev 100% emulado
import type { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: false,
  stage: false,
  env: 'dev-emu',

  firebase: {
    apiKey: 'fake-api-key', // qualquer string
    authDomain: 'localhost',
    projectId: 'entretenimento-sexual', // mantém o mesmo projectId
    storageBucket: 'fake-bucket',
    appId: 'demo-app',
    messagingSenderId: '0',
  },

  authActionHandlerBaseUrl: 'http://localhost:4200',
  apiEndpoint: 'http://localhost:3000',
  enableDebugTools: true,

  useEmulators: true,
  emulators: {
    auth: { host: '127.0.0.1', port: 9099 },
    firestore: { host: '127.0.0.1', port: 8080 },
    storage: { host: '127.0.0.1', port: 9199 },
    functions: { host: '127.0.0.1', port: 5001 },
    database: { host: '127.0.0.1', port: 9000 },
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

  appCheck: {
    enabled: false,
    provider: 'reCaptchaV3',
    siteKey: 'dev-recaptcha-v3-site-key',
  },

  features: {
    enforceEmailVerified: false,
    showGuestBanner: true,
    restrictedRoutesWhenUnverified: ['/dashboard/chat', '/dashboard/featured-profiles'],
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
};
