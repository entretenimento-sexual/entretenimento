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
import { PhotoEditorModule } from './photo-editor/photo-editor.module';
import { AppStoreModule } from './store/store.module';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { environment } from '../environments/environment';

// =============================================================================
// AngularFire
// =============================================================================
import { provideFirebaseApp } from '@angular/fire/app';
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

/**
 * Chave usada para controlar o modo de persistência do Auth Emulator.
 *
 * Valores válidos:
 * - "memory"
 * - "session"
 *
 * Importante:
 * - deve permanecer sincronizada com src/main.ts
 */
const EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';

type EmuPersistMode = 'memory' | 'session';

// =============================================================================
// Helpers utilitários
// =============================================================================

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Log mínimo, respeitando o helper DBG definido no main.ts.
 * Não quebra o bootstrap se o DBG não existir.
 */
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

function hasEmulatorTarget(kind: 'auth' | 'firestore' | 'database' | 'storage'): boolean {
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

/**
 * Helper único para evitar divergência entre initializer e provider.
 *
 * REGRA DO PROJETO:
 * - a sessão deve sobreviver ao refresh em qualquer ambiente
 * - no emulator, o default é "session"
 * - "memory" existe apenas como ferramenta manual de troubleshooting
 *
 * Isso mantém o comportamento esperado de grandes plataformas:
 * - usuário autenticado não “cai” no refresh
 * - a restauração da sessão continua previsível
 */
function getEmuPersistMode(): EmuPersistMode {
  if (!isBrowser()) return 'session';

  const raw = (localStorage.getItem(EMU_AUTH_PERSIST_KEY) || '')
    .trim()
    .toLowerCase();

  return raw === 'memory' ? 'memory' : 'session';
}

/**
 * Conecta o Auth Emulator apenas uma vez.
 * Isso evita ruído em HMR / re-bootstrap.
 */
function connectAuthEmulatorOnce(auth: Auth, url: string): void {
  const marker = '__authEmulatorConnected__';

  if ((auth as any)[marker] === true) return;

  connectAuthEmulator(auth, url, { disableWarnings: true });
  (auth as any)[marker] = true;
}

/**
 * Marca defensiva para Firestore Emulator.
 */
function connectFirestoreEmulatorOnce(db: any, host: string, port: number): void {
  const marker = '__firestoreEmulatorConnected__';

  if ((db as any)[marker] === true) return;

  connectFirestoreEmulator(db, host, port);
  (db as any)[marker] = true;
}

/**
 * Marca defensiva para RTDB Emulator.
 */
function connectDatabaseEmulatorOnce(db: any, host: string, port: number): void {
  const marker = '__databaseEmulatorConnected__';

  if ((db as any)[marker] === true) return;

  connectDatabaseEmulator(db, host, port);
  (db as any)[marker] = true;
}

/**
 * Marca defensiva para Storage Emulator.
 */
function connectStorageEmulatorOnce(storage: any, host: string, port: number): void {
  const marker = '__storageEmulatorConnected__';

  if ((storage as any)[marker] === true) return;

  connectStorageEmulator(storage, host, port);
  (storage as any)[marker] = true;
}

// =============================================================================
// APP_INITIALIZER
// =============================================================================

/**
 * Segura o bootstrap lógico da aplicação até o Firebase Auth resolver
 * a restauração da sessão atual.
 *
 * Por que isso importa?
 * - evita flash de auth.currentUser = null no boot
 * - evita guards e router decidirem cedo demais
 * - reduz redirect indevido para /login em refresh/cold start
 *
 * Regras:
 * - fora do emulator: apenas aguardamos authStateReady()
 * - no emulator:
 *   - session: mantemos a sessão e validamos via reload()
 *   - memory: não restaura por definição; se houver currentUser, tratamos como ghost
 */
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

      // Fora do emulator, basta esperar o restore natural do SDK.
      if (!usingEmu) return;

      const currentUser = auth.currentUser;

      // Em "memory", não esperamos restore persistido.
      // Se houver usuário aqui, tratamos como sessão fantasma.
      if (persistMode === 'memory' && currentUser) {
        safeDbg('[AUTH][INIT] memory-mode ghost -> signOut()', {
          uid: currentUser.uid,
        });

        await signOut(auth);
        return;
      }

      if (!currentUser) return;

      // Em "session", validamos a sessão restaurada contra o emulator.
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

// =============================================================================
// Module
// =============================================================================

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
    PhotoEditorModule,

    AppStoreModule,

    ...(environment.production
      ? []
      : [StoreDevtoolsModule.instrument({ maxAge: 25, trace: true })]),

    // Standalone import
    AdminLinkComponent,
  ],

  providers: [
    // =========================================================================
    // Firebase App
    // =========================================================================
    provideFirebaseApp(() => initializeApp(environment.firebase)),

    // =========================================================================
    // APP_INITIALIZER
    // Garante que o Auth seja resolvido antes do app decidir navegação crítica
    // =========================================================================
    {
      provide: APP_INITIALIZER,
      useFactory: authRestoreInitializer,
      deps: [Auth, GlobalErrorHandlerService],
      multi: true,
    },

    // =========================================================================
    // Auth
    //
    // Estratégia:
    // - emulator: default = session (mantém sessão no refresh)
    // - cloud/prod: persistência forte
    //
    // Ordem de persistência fora do emulator:
    // - IndexedDB
    // - localStorage
    // - sessionStorage
    // =========================================================================
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
        // HMR / rebootstrap / já inicializado
        auth = getAuth(app);

        // Reforço best-effort da persistência.
        // Não bloqueia bootstrap.
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

        // Ping best-effort, útil em ambiente local.
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

    // =========================================================================
    // Firestore
    //
    // Estratégia:
    // - long polling em dev melhora robustez em ambientes locais/restritivos
    // - fallback para getFirestore em HMR/rebootstrap
    // =========================================================================
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

    // =========================================================================
    // Realtime Database
    // =========================================================================
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

    // =========================================================================
    // Storage
    // =========================================================================
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

    // =========================================================================
    // Erro global / notificação / locale
    // =========================================================================
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],

  bootstrap: [AppComponent],
})
export class AppModule {}
