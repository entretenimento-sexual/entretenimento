// src/environments/environment.prod.ts
// Ambiente de PRODUÇÃO
// - Sem emuladores
// - Políticas rígidas
// - Debug tools desligadas
import { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: true,
  stage: false,
  env: 'prod',
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

  apiEndpoint: 'https://api.seuprojeto.com',
  enableDebugTools: false,

  privacyLogging: {
    enabled: false,
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
      enabled: false, // ⬅️ deixe off até decidir usar proxy + chave no backend
      apiKey: undefined,
      useProxy: true,
      region: 'us-central1',
    },
  },
  appCheck: {
    enabled: true,
    provider: 'reCaptchaV3',

    // App Check / reCAPTCHA v3 - troca obrigatória antes do deploy público.
    // Passo a passo:
    // 1. Acesse o Firebase Console do projeto de produção: entretenimento-sexual.
    // 2. Abra App Check.
    // 3. Selecione o app Web correspondente a este Firebase appId.
    // 4. Registre/ative o provedor reCAPTCHA v3 para o app Web.
    // 5. Informe os domínios reais do app, incluindo o domínio do Firebase Hosting
    //    e qualquer domínio customizado usado em produção.
    // 6. Copie a site key gerada pelo reCAPTCHA v3.
    // 7. Substitua o placeholder abaixo pela chave real.
    // 8. Rode: npm.cmd run validate:prod
    // 9. Só depois faça deploy. O AppModule bloqueia o boot se esta chave continuar
    //    vazia ou como placeholder, para evitar produção sem App Check efetivo.
    siteKey: '6LcL3k8tAAAAALjZRaY4sQiD40xSnkNqtXVed-dI',
  },

  features: {
    enforceEmailVerified: true,
    showGuestBanner: false,
    restrictedRoutesWhenUnverified: [
      '/dashboard',
      '/chat',
      '/friends',
      '/upload',
    ],
    subscriberExperiencesPreview: false,
    communityPreview: false,
  },

  friendsPageSize: 24,
  dashboardFriendsLimit: 12,
};
