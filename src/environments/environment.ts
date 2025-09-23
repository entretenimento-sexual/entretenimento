// src/environments/environment.ts
// Ambiente de DESENVOLVIMENTO
// - Usa EMULADORES do Firebase (auth, firestore, storage, functions)
// - Debug tools ligadas
// - Flags menos restritivas para facilitar o dev
// - NUNCA coloque segredos aqui (ex.: chaves privadas de APIs)

export const environment = {
  production: false,
  stage: false,
  env: 'development',

  firebase: {
    apiKey: 'AIzaSyAtk-mc6oVZOqu9u7_2KIpk570q8O8Jrl0',
    authDomain: 'entretenimento-sexual.firebaseapp.com',
    databaseURL: 'https://entretenimento-sexual-default-rtdb.firebaseio.com',
    projectId: 'entretenimento-sexual',
    storageBucket: 'entretenimento-sexual.appspot.com',
    messagingSenderId: '668950141209',
    appId: '1:668950141209:web:73e27794c51e493cf44d88',
    measurementId: 'G-GWTPJVK044', // opcional em dev
  },

  // Endpoint local/DEV para sua API própria (se houver)
  apiEndpoint: 'http://localhost:3000',

  // Ferramentas de debug (NgRx devtools, logs verbosos, etc.)
  enableDebugTools: true,

  // 🔒 NUNCA exponha segredos no cliente
  // Se precisar usar VirusTotal, faça pelo seu backend.
  // Mantemos a chave vazia para não quebrar importações existentes.
  virusTotalApiKey: '4dbf2ec49dbf5da51142aef571f39f00809ff78991f9ad1f7c1f2ce322e84ecbY',

  // ⚙️ Emuladores (usados pelo firebase.factory.ts)
  useEmulators: false,
  emulators: {
    auth: { host: 'localhost', port: 9099 },
    firestore: { host: 'localhost', port: 8080 },
    storage: { host: 'localhost', port: 9199 },
    functions: { host: 'localhost', port: 5001 },
  },

  // App Check (site key é pública; útil para reduzir abuso)
  appCheck: {
    enabled: false,            // em dev, geralmente desabilitado
    provider: 'reCaptchaV3',   // ou 'reCaptchaEnterprise'
    siteKey: 'dev-recaptcha-v3-site-key',
  },

  // Feature flags que seu app pode ler (guards, componentes, etc.)
  features: {
    enforceEmailVerified: false,     // ✅ dev: mais flexível
    showGuestBanner: true,
    // Você pode usar isto em guards para bloquear áreas:
    restrictedRoutesWhenUnverified: ['/dashboard/chat', '/dashboard/featured-profiles'],
  },
};
