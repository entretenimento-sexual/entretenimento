// src/app/app.module.ts
// =============================================================================
// APP MODULE
//
// Responsabilidades centrais deste módulo:
// - bootstrap global da aplicação Angular
// - configuração do Firebase / AngularFire
// - conexão com emuladores em dev-emu
// - restauração defensiva da sessão Auth antes da aplicação decidir rotas/guards
// - providers globais de erro, i18n e módulos-base
//
// Observação arquitetural:
// - O src/main.ts continua sendo a camada de bootstrap + debug global.
// - Este AppModule apenas consome as convenções definidas lá,
//   especialmente a chave de persistência do Auth Emulator.
// =============================================================================

import {
  APP_INITIALIZER,
  ErrorHandler,
  LOCALE_ID,
  NgModule,
} from '@angular/core';

import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';

import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { StoreDevtoolsModule } from '@ngrx/store-devtools';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { AppStoreModule } from './store/store.module';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { environment } from '../environments/environment';

// =============================================================================
// AngularFire
// =============================================================================
import { provideFirebaseApp } from '@angular/fire/app';
import {
  initializeAppCheck,
  provideAppCheck,
  ReCaptchaV3Provider,
} from '@angular/fire/app-check';
import {
  Auth,
  connectAuthEmulator,
  provideAuth,
} from '@angular/fire/auth';
import {
  connectFirestoreEmulator,
  provideFirestore,
} from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';
import { provideStorage } from '@angular/fire/storage';
import {
  connectFunctionsEmulator,
  getFunctions,
  provideFunctions,
} from '@angular/fire/functions';

// =============================================================================
// Firebase Web SDK
// =============================================================================
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
  signOut,
} from 'firebase/auth';

import {
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';

import {
  connectDatabaseEmulator,
  getDatabase,
} from 'firebase/database';

import {
  connectStorageEmulator,
  getStorage,
} from 'firebase/storage';

// =============================================================================
// Standalone imports
// =============================================================================
import { AdminLinkComponent } from './admin-dashboard/admin-link/admin-link.component';

// =============================================================================
// Locale
// =============================================================================
registerLocaleData(localePt, 'pt-BR');

// =============================================================================
// Constantes compartilhadas com src/main.ts
// =============================================================================

const EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';
const CALLABLE_FUNCTIONS_REGION = 'us-central1' as const;

const APP_CHECK_PLACEHOLDER_VALUES = [
  'prod-recaptcha-v3-site-key',
  'staging-recaptcha-v3-site-key',
  'dev-recaptcha-v3-site-key',
];

type EmuPersistMode = 'memory' | 'session';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function safeDbg(message: string, extra?: unknown): void {
  try {
    if (!isBrowser()) return;
    (window as any)?.DBG?.(message, extra ?? '');
  } catch {
    // noop
  }
}

function isUsingEmulators(): boolean {
  const cfg: any = environment;
  return !environment.production && cfg?.useEmulators === true;
}

function isAppCheckEnabled(): boolean {
  const cfg: any = environment;
  return cfg?.appCheck?.enabled === true && !isUsingEmulators();
}

function resolveAppCheckSiteKey(): string {
  const cfg: any = environment;
  const siteKey = String(cfg?.appCheck?.siteKey ?? '').trim();

  if (!siteKey || APP_CHECK_PLACEHOLDER_VALUES.includes(siteKey)) {
    throw new Error(
      `[AppCheck] Configure uma siteKey real do reCAPTCHA v3 para o ambiente ${environment.env}.`
    );
  }

  return siteKey;
}

function hasEmulatorTarget(
  kind: 'auth' | 'firestore' | 'database' | 'storage' | 'functions'
): boolean {
  const cfg: any = environment;
  return !!cfg?.emulators?.[kind]?.host && !!cfg?.emulators?.[kind]?.port;
}

function isUsingAuthEmulator(): boolean {
  return isUsingEmulators() && hasEmulatorTarget('auth');
}

function isUsingFirestoreEmulator(): boolean {
  return isUsingEmulators() && hasEmulatorTarget('firestore');
}

function isUsingDatabaseEmulator(): boolean {
  return isUsingEmulators() && hasEmulatorTarget('database');
}

function isUsingStorageEmulator(): boolean {
  return isUsingEmulators() && hasEmulatorTarget('storage');
}

function isUsingFunctionsEmulator(): boolean {
  return isUsingEmulators() && hasEmulatorTarget('functions');
}

function getEmuPersistMode(): EmuPersistMode {
  if (!isBrowser()) return 'session';

  const raw = (localStorage.getItem(EMU_AUTH_PERSIST_KEY) || '')
    .trim()
    .toLowerCase();

  return raw === 'memory' ? 'memory' : 'session';
}

function connectAuthEmulatorOnce(auth: Auth, url: string): void {
  const marker = '__authEmulatorConnected__';
  if ((auth as any)[marker] === true) return;
  connectAuthEmulator(auth, url, { disableWarnings: true });
  (auth as any)[marker] = true;
}

function connectFirestoreEmulatorOnce(
  db: any,
  host: string,
  port: number
): void {
  const marker = '__firestoreEmulatorConnected__';
  if ((db as any)[marker] === true) return;
  connectFirestoreEmulator(db, host, port);
  (db as any)[marker] = true;
}

function connectDatabaseEmulatorOnce(
  db: any,
  host: string,
  port: number
): void {
  const marker = '__databaseEmulatorConnected__';
  if ((db as any)[marker] === true) return;
  connectDatabaseEmulator(db, host, port);
  (db as any)[marker] = true;
}

function connectStorageEmulatorOnce(
  storage: any,
  host: string,
  port: number
): void {
  const marker = '__storageEmulatorConnected__';
  if ((storage as any)[marker] === true) return;
  connectStorageEmulator(storage, host, port);
  (storage as any)[marker] = true;
}

function connectFunctionsEmulatorOnce(
  functions: any,
  host: string,
  port: number
): void {
  const marker = '__functionsEmulatorConnected__';
  if ((functions as any)[marker] === true) return;
  connectFunctionsEmulator(functions, host, port);
  (functions as any)[marker] = true;
}

export function authRestoreInitializer(
  auth: Auth,
  geh: GlobalErrorHandlerService
) {
  return async (): Promise<void> => {
    try {
      await ((auth as any).authStateReady?.() ?? Promise.resolve());

      const usingEmu = isUsingAuthEmulator();
      const persistMode = usingEmu ? getEmuPersistMode() : 'cloud';

      safeDbg('[AUTH][INIT] authStateReady()', {
        env: environment.env,
        usingEmu,
        persistMode,
        currentUserUid: auth.currentUser?.uid ?? null,
      });

      if (!usingEmu) return;

      const currentUser = auth.currentUser;

      if (persistMode === 'memory' && currentUser) {
        safeDbg('[AUTH][INIT] memory-mode ghost -> signOut()', {
          uid: currentUser.uid,
        });

        await signOut(auth);
        return;
      }

      if (!currentUser) return;

      try {
        await currentUser.reload();

        safeDbg('[AUTH][INIT] reload ok', {
          uid: currentUser.uid,
          emailVerified: currentUser.emailVerified === true,
        });
      } catch (e: any) {
        const code = String(e?.code || '');

        safeDbg('[AUTH][INIT] reload failed', {
          uid: currentUser.uid,
          code,
        });

        if (
          code === 'auth/user-not-found' ||
          code === 'auth/invalid-user-token' ||
          code === 'auth/user-token-expired' ||
          code === 'auth/user-disabled'
        ) {
          await signOut(auth);
        }
      }
    } catch (err) {
      geh.handleError(err as any);
    }
  };
}

@NgModule({
  declarations: [AppComponent],

  imports: [
    BrowserModule,
    AppRoutingModule,

    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    BrowserAnimationsModule,

    MatDialogModule,
    MatSnackBarModule,

    HeaderModule,
    FooterModule,
    AppStoreModule,

    ...(environment.production
      ? []
      : [StoreDevtoolsModule.instrument({ maxAge: 25, trace: true })]),

    AdminLinkComponent,
  ],

  providers: [
    provideFirebaseApp(() => initializeApp(environment.firebase)),

    ...(isAppCheckEnabled()
      ? [
          provideAppCheck(() => initializeAppCheck(getApp(), {
            provider: new ReCaptchaV3Provider(resolveAppCheckSiteKey()),
            isTokenAutoRefreshEnabled: true,
          })),
        ]
      : []),

    provideFunctions(() => {
      const functions = getFunctions(getApp(), CALLABLE_FUNCTIONS_REGION);

      if (isUsingFunctionsEmulator()) {
        const cfg: any = environment;

        connectFunctionsEmulatorOnce(
          functions,
          cfg.emulators.functions.host,
          cfg.emulators.functions.port
        );

        safeDbg('[FUNCTIONS][PROVIDE] emulator connected', {
          region: CALLABLE_FUNCTIONS_REGION,
          host: cfg.emulators.functions.host,
          port: cfg.emulators.functions.port,
        });
      } else {
        safeDbg('[FUNCTIONS][PROVIDE] cloud configured', {
          env: environment.env,
          region: CALLABLE_FUNCTIONS_REGION,
        });
      }
      return functions;
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: authRestoreInitializer,
      deps: [Auth, GlobalErrorHandlerService],
      multi: true,
    },

    provideAuth(() => {
      const app = getApp();
      const usingEmu = isUsingAuthEmulator();
      const emuMode = usingEmu ? getEmuPersistMode() : 'session';

      const emuPersistence =
        emuMode === 'memory'
          ? inMemoryPersistence
          : browserSessionPersistence;

      const persistence = usingEmu
        ? [emuPersistence]
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

        const fallbackPersistence = usingEmu
          ? emuPersistence
          : browserLocalPersistence;

        setPersistence(auth, fallbackPersistence).catch(() => {
          // noop
        });
      }

      if (usingEmu) {
        const cfg: any = environment;
        const url = `http://${cfg.emulators.auth.host}:${cfg.emulators.auth.port}`;

        connectAuthEmulatorOnce(auth, url);

        try {
          fetch(url, { mode: 'no-cors' }).catch(() => {
            // noop
          });
        } catch {
          // noop
        }
      }

      safeDbg('[AUTH][PROVIDE] configured', {
        env: environment.env,
        usingEmu,
        emuMode: usingEmu ? emuMode : 'cloud',
      });

      return auth;
    }),

    provideFirestore(() => {
      const app = getApp();

      let db: any;

      try {
        db = initializeFirestore(app, {
          experimentalForceLongPolling: true,
          useFetchStreams: false,
          ignoreUndefinedProperties: true,
        } as any);
      } catch {
        db = getFirestore(app);
      }

      if (isUsingFirestoreEmulator()) {
        const cfg: any = environment;
        connectFirestoreEmulatorOnce(
          db,
          cfg.emulators.firestore.host,
          cfg.emulators.firestore.port
        );
      }

      return db;
    }),

    provideDatabase(() => {
      const db = getDatabase(getApp());

      if (isUsingDatabaseEmulator()) {
        const cfg: any = environment;
        connectDatabaseEmulatorOnce(
          db,
          cfg.emulators.database.host,
          cfg.emulators.database.port
        );
      }

      return db;
    }),

    provideStorage(() => {
      const storage = getStorage(getApp());

      if (isUsingStorageEmulator()) {
        const cfg: any = environment;
        connectStorageEmulatorOnce(
          storage,
          cfg.emulators.storage.host,
          cfg.emulators.storage.port
        );
      }

      return storage;
    }),

    GlobalErrorHandlerService,
    {
      provide: ErrorHandler,
      useExisting: GlobalErrorHandlerService,
    },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],

  bootstrap: [AppComponent],
})
export class AppModule {}
