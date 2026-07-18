import {
  APP_INITIALIZER,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { provideFirebaseApp } from '@angular/fire/app';
import {
  initializeAppCheck,
  provideAppCheck,
  ReCaptchaV3Provider,
} from '@angular/fire/app-check';
import { Auth, provideAuth } from '@angular/fire/auth';
import { provideDatabase } from '@angular/fire/database';
import { provideFirestore } from '@angular/fire/firestore';
import { provideFunctions } from '@angular/fire/functions';
import { provideStorage } from '@angular/fire/storage';
import { getApp, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  setPersistence,
  type Persistence,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

import { environment } from '../../../environments/environment';
import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
import { authRestoreInitializer } from './firebase-auth-session.initializer';
import {
  firebaseDebugLog,
  getFirebaseEmulatorEndpoint,
  isBrowserRuntime,
  isFirebaseAppCheckEnabled,
  resolveFirebaseAppCheckSiteKey,
  resolveFirebaseAuthEmulatorPersistenceMode,
} from './firebase-environment.config';
import {
  connectAuthEmulatorSafely,
  connectDatabaseEmulatorSafely,
  connectFirestoreEmulatorSafely,
  connectFunctionsEmulatorSafely,
  connectStorageEmulatorSafely,
} from './firebase-emulator-connectors';
import { FIREBASE_CALLABLE_FUNCTIONS_REGION } from './firebase-runtime.constants';

function warmUpAuthEmulator(host: string, port: number): void {
  if (!isBrowserRuntime() || typeof globalThis.fetch !== 'function') return;

  const url = `http://${host}:${port}`;

  void globalThis.fetch(url, { mode: 'no-cors' }).catch(() => {
    // O warm-up é apenas diagnóstico e não pode bloquear o bootstrap.
  });
}

function provideApplicationAuth(): EnvironmentProviders {
  return provideAuth(() => {
    const app = getApp();
    const authEmulatorEndpoint = getFirebaseEmulatorEndpoint('auth');
    const usingAuthEmulator = authEmulatorEndpoint !== null;
    const emulatorPersistenceMode = usingAuthEmulator
      ? resolveFirebaseAuthEmulatorPersistenceMode()
      : 'session';

    const emulatorPersistence: Persistence =
      emulatorPersistenceMode === 'memory'
        ? inMemoryPersistence
        : browserSessionPersistence;

    const persistence: Persistence[] = usingAuthEmulator
      ? [emulatorPersistence]
      : [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
        ];

    let auth: Auth;

    try {
      auth = initializeAuth(app, {
        persistence,
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      auth = getAuth(app);

      const fallbackPersistence = usingAuthEmulator
        ? emulatorPersistence
        : browserLocalPersistence;

      void setPersistence(auth, fallbackPersistence).catch((error: unknown) => {
        firebaseDebugLog('[AUTH][PROVIDE] fallback persistence failed', {
          errorType:
            error instanceof Error ? error.name : typeof error,
        });
      });
    }

    if (authEmulatorEndpoint) {
      connectAuthEmulatorSafely(auth, authEmulatorEndpoint);
      warmUpAuthEmulator(
        authEmulatorEndpoint.host,
        authEmulatorEndpoint.port
      );
    }

    firebaseDebugLog('[AUTH][PROVIDE] configured', {
      env: environment.env,
      usingAuthEmulator,
      persistenceMode: usingAuthEmulator
        ? emulatorPersistenceMode
        : 'cloud',
    });

    return auth;
  });
}

function provideApplicationFirestore(): EnvironmentProviders {
  return provideFirestore(() => {
    const app = getApp();
    const firestoreSettings = {
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      ignoreUndefinedProperties: true,
    } as Parameters<typeof initializeFirestore>[1];

    let firestore;

    try {
      firestore = initializeFirestore(app, firestoreSettings);
    } catch {
      firestore = getFirestore(app);
    }

    const firestoreEmulatorEndpoint =
      getFirebaseEmulatorEndpoint('firestore');

    if (firestoreEmulatorEndpoint) {
      connectFirestoreEmulatorSafely(
        firestore,
        firestoreEmulatorEndpoint
      );
    }

    return firestore;
  });
}

function provideApplicationDatabase(): EnvironmentProviders {
  return provideDatabase(() => {
    const database = getDatabase(getApp());
    const databaseEmulatorEndpoint =
      getFirebaseEmulatorEndpoint('database');

    if (databaseEmulatorEndpoint) {
      connectDatabaseEmulatorSafely(database, databaseEmulatorEndpoint);
    }

    return database;
  });
}

function provideApplicationStorage(): EnvironmentProviders {
  return provideStorage(() => {
    const storage = getStorage(getApp());
    const storageEmulatorEndpoint =
      getFirebaseEmulatorEndpoint('storage');

    if (storageEmulatorEndpoint) {
      connectStorageEmulatorSafely(storage, storageEmulatorEndpoint);
    }

    return storage;
  });
}

function provideApplicationFunctions(): EnvironmentProviders {
  return provideFunctions(() => {
    const functions = getFunctions(
      getApp(),
      FIREBASE_CALLABLE_FUNCTIONS_REGION
    );
    const functionsEmulatorEndpoint =
      getFirebaseEmulatorEndpoint('functions');

    if (functionsEmulatorEndpoint) {
      connectFunctionsEmulatorSafely(
        functions,
        functionsEmulatorEndpoint
      );

      firebaseDebugLog('[FUNCTIONS][PROVIDE] emulator connected', {
        region: FIREBASE_CALLABLE_FUNCTIONS_REGION,
        host: functionsEmulatorEndpoint.host,
        port: functionsEmulatorEndpoint.port,
      });
    } else {
      firebaseDebugLog('[FUNCTIONS][PROVIDE] cloud configured', {
        env: environment.env,
        region: FIREBASE_CALLABLE_FUNCTIONS_REGION,
      });
    }

    return functions;
  });
}

export const FIREBASE_APPLICATION_PROVIDERS: Array<
  Provider | EnvironmentProviders
> = [
  provideFirebaseApp(() => initializeApp(environment.firebase)),

  ...(isFirebaseAppCheckEnabled()
    ? [
        provideAppCheck(() =>
          initializeAppCheck(getApp(), {
            provider: new ReCaptchaV3Provider(
              resolveFirebaseAppCheckSiteKey()
            ),
            isTokenAutoRefreshEnabled: true,
          })
        ),
      ]
    : []),

  provideApplicationFunctions(),
  provideApplicationAuth(),
  provideApplicationFirestore(),
  provideApplicationDatabase(),
  provideApplicationStorage(),

  {
    provide: APP_INITIALIZER,
    useFactory: authRestoreInitializer,
    deps: [Auth, GlobalErrorHandlerService],
    multi: true,
  },
];
