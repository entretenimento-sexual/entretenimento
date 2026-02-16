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

    // opcionais (produção/dev-real podem ter)
    databaseURL?: string;
    measurementId?: string;
  };

  authActionHandlerBaseUrl?: string;
  apiEndpoint?: string;
  enableDebugTools?: boolean;

  useEmulators: boolean;
  emulators?: EmulatorsConfig;

  [key: string]: any;
}
