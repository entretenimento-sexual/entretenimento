// src/environments/environment.model.ts
export type EnvName = 'dev-real' | 'dev-emu' | 'staging' | 'prod';

export type EmulatorEndpoint = { host: string; port: number };

export type EmulatorsConfig = Partial<{
  auth: EmulatorEndpoint;
  firestore: EmulatorEndpoint;
  storage: EmulatorEndpoint;
  functions: EmulatorEndpoint;
  database: EmulatorEndpoint;
}>;

// ---------------------------
// AppCheck
// ---------------------------
export interface AppCheckConfig {
  enabled: boolean;
  provider?: string;
  siteKey?: string;
}

// ---------------------------
// Integrations
// ---------------------------
export interface VirusTotalIntegrationConfig {
  enabled: boolean;
  apiKey?: string;
  useProxy?: boolean;
  region?: string;
}

export interface IntegrationsConfig {
  virusTotal?: VirusTotalIntegrationConfig;
}

// ---------------------------
// Features flags
// ---------------------------
export interface FeaturesConfig {
  enforceEmailVerified?: boolean;
  showGuestBanner?: boolean;
  restrictedRoutesWhenUnverified?: string[];
}

// ---------------------------
// Privacy / logging
// ---------------------------
export interface PrivacyLoggingConfig {
  /**
   * Permite logs técnicos não sensíveis.
   *
   * Produção ainda deve manter isso false.
   */
  enabled: boolean;

  /**
   * Permite dados pessoais em claro no console.
   *
   * Deve ficar false por padrão em todos os ambientes.
   * Só deve ser usado em investigação muito específica.
   */
  allowSensitiveConsoleData: boolean;

  /**
   * Permite trace detalhado de cache de usuário.
   *
   * Mesmo quando true, o CacheService ainda exigirá ativação manual
   * via localStorage para evitar vazamento acidental.
   */
  allowCacheTrace: boolean;

  /**
   * Permite stack trace nos logs de cache.
   *
   * Deve ficar false por padrão.
   */
  includeStackTrace?: boolean;
}

export interface AppEnvironment {
  production: boolean;
  stage: boolean;
  env: EnvName;

  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    appId: string;
    messagingSenderId: string;

    databaseURL?: string;
    measurementId?: string;
  };

  authActionHandlerBaseUrl?: string;
  apiEndpoint?: string;
  enableDebugTools?: boolean;
  privacyLogging?: PrivacyLoggingConfig;

  useEmulators: boolean;
  emulators?: EmulatorsConfig;

  // ✅ tipados (param de TS4111)
  integrations?: IntegrationsConfig;
  features?: FeaturesConfig;
  appCheck?: AppCheckConfig;

  // ✅ usados nos seus envs
  friendsPageSize?: number;
  dashboardFriendsLimit?: number;
}
