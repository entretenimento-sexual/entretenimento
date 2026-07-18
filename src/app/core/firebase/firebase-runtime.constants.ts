export const FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY =
  '__EMU_AUTH_PERSIST__';

export type FirebaseAuthEmulatorPersistenceMode = 'memory' | 'session';

export const FIREBASE_CALLABLE_FUNCTIONS_REGION = 'us-central1' as const;

export const FIREBASE_APP_CHECK_PLACEHOLDER_SITE_KEYS = [
  'prod-recaptcha-v3-site-key',
  'staging-recaptcha-v3-site-key',
  'dev-recaptcha-v3-site-key',
] as const;
