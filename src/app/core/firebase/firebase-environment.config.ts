import { environment } from '../../../environments/environment';
import type {
  EmulatorEndpoint,
  EmulatorsConfig,
} from '../../../environments/environment.model';
import {
  FIREBASE_APP_CHECK_PLACEHOLDER_SITE_KEYS,
  FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY,
  type FirebaseAuthEmulatorPersistenceMode,
} from './firebase-runtime.constants';

export type FirebaseEmulatorKind = keyof EmulatorsConfig;

export interface FirebasePersistenceStorageReader {
  getItem(key: string): string | null;
}

interface FirebaseDebugWindow extends Window {
  DBG?: (...args: unknown[]) => void;
}

export function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined';
}

export function firebaseDebugLog(message: string, extra?: unknown): void {
  try {
    if (!isBrowserRuntime()) return;

    (window as FirebaseDebugWindow).DBG?.(message, extra ?? '');
  } catch {
    // Debug nunca pode interromper a inicialização da aplicação.
  }
}

export function isFirebaseEmulatorSuiteEnabled(): boolean {
  return !environment.production && environment.useEmulators === true;
}

export function normalizeFirebaseEmulatorEndpoint(
  kind: FirebaseEmulatorKind,
  endpoint: EmulatorEndpoint | undefined
): EmulatorEndpoint | null {
  if (!endpoint) return null;

  const host = endpoint.host.trim();
  const port = Number(endpoint.port);

  if (!host) {
    throw new Error(
      `[Firebase Emulator] Host inválido para o serviço ${kind}.`
    );
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `[Firebase Emulator] Porta inválida para o serviço ${kind}.`
    );
  }

  return { host, port };
}

/**
 * An enabled emulator suite must never silently fall through to Cloud Firebase.
 * Require a configured loopback endpoint for every requested service.
 */
export function requireLocalFirebaseEmulatorEndpoint(
  kind: FirebaseEmulatorKind,
  config: EmulatorsConfig | undefined
): EmulatorEndpoint {
  const endpoint = normalizeFirebaseEmulatorEndpoint(kind, config?.[kind]);
  if (!endpoint) {
    throw new Error(`[Firebase Emulator] Endpoint obrigatório ausente para ${kind}.`);
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.host)) {
    throw new Error(`[Firebase Emulator] Host não local para ${kind}.`);
  }
  return endpoint;
}

export function getFirebaseEmulatorEndpoint(
  kind: FirebaseEmulatorKind
): EmulatorEndpoint | null {
  if (!isFirebaseEmulatorSuiteEnabled()) return null;
  return requireLocalFirebaseEmulatorEndpoint(kind, environment.emulators);
}

export function isFirebaseAppCheckEnabled(): boolean {
  return (
    environment.appCheck?.enabled === true &&
    !isFirebaseEmulatorSuiteEnabled()
  );
}

export function resolveFirebaseAppCheckSiteKey(): string {
  const siteKey = String(environment.appCheck?.siteKey ?? '').trim();
  const placeholderKeys =
    FIREBASE_APP_CHECK_PLACEHOLDER_SITE_KEYS as readonly string[];

  if (!siteKey || placeholderKeys.includes(siteKey)) {
    throw new Error(
      `[AppCheck] Configure uma siteKey real do reCAPTCHA v3 para o ambiente ${environment.env}.`
    );
  }

  return siteKey;
}

function getBrowserPersistenceStorage(): FirebasePersistenceStorageReader | null {
  if (!isBrowserRuntime()) return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function resolveFirebaseAuthEmulatorPersistenceMode(
  storage: FirebasePersistenceStorageReader | null =
    getBrowserPersistenceStorage()
): FirebaseAuthEmulatorPersistenceMode {
  if (!storage) return 'session';

  try {
    const raw = String(
      storage.getItem(FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY) ?? ''
    )
      .trim()
      .toLowerCase();

    return raw === 'memory' ? 'memory' : 'session';
  } catch {
    return 'session';
  }
}
