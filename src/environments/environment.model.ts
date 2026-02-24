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
