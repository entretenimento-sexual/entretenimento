// src/app/app.module.ts
// Não esqueça os comentáros explicativos e ferramentas de debug no src/main.ts, que são parte essencial da experiência de desenvolvimento! 🚀
import { NgModule, ErrorHandler, LOCALE_ID, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';

import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { AppStoreModule } from './store/store.module';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { environment } from '../environments/environment';

// AngularFire
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth, connectAuthEmulator, Auth } from '@angular/fire/auth';
import { provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';

// Firebase Web SDK (Auth)
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  signOut,
  setPersistence,
} from 'firebase/auth';

// Firebase Web SDK (Firestore)
import { initializeFirestore } from 'firebase/firestore';

// RTDB & Storage
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { provideStorage, connectStorageEmulator } from '@angular/fire/storage';
import { getStorage } from 'firebase/storage';

// i18n
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
registerLocaleData(localePt, 'pt-BR');

// Standalone
import { AdminLinkComponent } from './admin-dashboard/admin-link/admin-link.component';

const EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';
// valores: 'memory' | 'session'

type EmuPersistMode = 'memory' | 'session';

/**
 * ✅ Helper único para evitar divergência entre initializer e provider.
 * - Default: 'session' (não cai no refresh).
 * - Use 'memory' apenas quando você quiser “anti-ghost” após reset do emulador.
 */
function getEmuPersistMode(): EmuPersistMode {
  if (typeof window === 'undefined') return 'session';
  const v = (localStorage.getItem(EMU_AUTH_PERSIST_KEY) || '').toLowerCase();
  return v === 'memory' ? 'memory' : 'session';
}

/**
 * ✅ APP_INITIALIZER: segura o bootstrap “lógico” até o Firebase Auth restaurar a sessão.
 *
 * Por que isso importa?
 * - Sem isso, guards/Router podem rodar com auth.currentUser=null no boot (flash),
 *   causando redirecionamentos errados (/login) mesmo com usuário “logado” na persistência.
 *
 * Além disso, no Auth Emulator:
 * - Em 'session': mantemos sessão entre refresh (bom pra dev).
 * - Em 'memory': não deve restaurar; se aparecer currentUser, é “fantasma” -> signOut.
 */
export function authRestoreInitializer(auth: Auth, geh: GlobalErrorHandlerService) {
  return async () => {
    try {
      await ((auth as any).authStateReady?.() ?? Promise.resolve());

      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.auth?.host &&
        cfg?.emulators?.auth?.port;

      // Log mínimo (aparece só se DBG estiver ligado no main.ts)
      try {
        (window as any)?.DBG?.('[AUTH][INIT] authStateReady()', {
          usingEmu,
          env: environment.env,
          persistMode: usingEmu ? getEmuPersistMode() : 'cloud',
          currentUserUid: auth.currentUser?.uid ?? null,
        });
      } catch { /* noop */ }

      if (!usingEmu) return;

      const persistMode = getEmuPersistMode();

      // ✅ Se estamos em "memory", não faz sentido restaurar nada do storage.
      // Se aparecer currentUser aqui, é “fantasma” => limpa logo (evita lookup 400).
      if (persistMode === 'memory' && auth.currentUser) {
        try {
          (window as any)?.DBG?.('[AUTH][INIT] memory-mode ghost -> signOut()', {
            uid: auth.currentUser?.uid ?? null,
          });
        } catch { /* noop */ }

        await signOut(auth);
        return;
      }

      const u = auth.currentUser;
      if (!u) return;

      // ✅ Em 'session': valida via reload.
      // Se o emulador não reconhecer, faz signOut.
      try {
        await u.reload();

        try {
          (window as any)?.DBG?.('[AUTH][INIT] reload ok', {
            uid: u.uid,
            emailVerified: !!u.emailVerified,
          });
        } catch { /* noop */ }
      } catch (e: any) {
        const code = String(e?.code || '');

        try {
          (window as any)?.DBG?.('[AUTH][INIT] reload failed', { code, e });
        } catch { /* noop */ }

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
      // Centralizado
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
    PhotoEditorModule,

    AppStoreModule,
    ...(environment.production ? [] : [StoreDevtoolsModule.instrument({ maxAge: 25, trace: true })]),

    // standalone
    AdminLinkComponent,
  ],
  providers: [
    // 🔥 Firebase App
    provideFirebaseApp(() => initializeApp(environment.firebase)),

    // ✅ Garante restore antes do app decidir rotas/guards
    {
      provide: APP_INITIALIZER,
      useFactory: authRestoreInitializer,
      deps: [Auth, GlobalErrorHandlerService],
      multi: true
    },

    // 🔐 Auth
    // - dev-emu: default = session (não cai no refresh)
    // - prod: persistência completa (IndexedDB -> local -> session)
    provideAuth(() => {
      const app = getApp();
      const cfg: any = environment;

      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.auth?.host &&
        cfg?.emulators?.auth?.port;

      const emuMode = usingEmu ? getEmuPersistMode() : 'session';

      // ✅ Emulador:
      // - session: mantém sessão no refresh (recomendado)
      // - memory: anti-ghost (cai no refresh por definição)
      const emuPersistence =
        emuMode === 'memory' ? inMemoryPersistence : browserSessionPersistence;

      const persistence = usingEmu
        ? [emuPersistence]
        : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence];

      let auth;
      try {
        auth = initializeAuth(app, {
          persistence,
          popupRedirectResolver: browserPopupRedirectResolver,
        });
      } catch {
        // Já inicializado (HMR / re-bootstrap / etc.)
        auth = getAuth(app);

        // ✅ best-effort: reforça persistência se caiu no catch
        // (setPersistence é async; não bloqueia bootstrap)
        if (usingEmu) {
          setPersistence(auth, emuPersistence).catch(() => { /* noop */ });
        }
      }

      if (usingEmu) {
        const url = `http://${cfg.emulators.auth.host}:${cfg.emulators.auth.port}`;
        connectAuthEmulator(auth, url, { disableWarnings: true });

        // ping best-effort (não bloqueia)
        try { fetch(url, { mode: 'no-cors' }).catch(() => { }); } catch { }
      }

      // Log mínimo (aparece só se DBG estiver ligado)
      try {
        (window as any)?.DBG?.('[AUTH][PROVIDE] configured', {
          usingEmu,
          env: environment.env,
          emuMode: usingEmu ? emuMode : 'cloud',
        });
      } catch { /* noop */ }

      return auth;
    }),

    // 🗄️ Firestore (long-polling + emulador)
    provideFirestore(() => {
      const app = getApp();

      const db = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        ignoreUndefinedProperties: true,
      } as any);

      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.firestore?.host &&
        cfg?.emulators?.firestore?.port;

      if (usingEmu) {
        connectFirestoreEmulator(db, cfg.emulators.firestore.host, cfg.emulators.firestore.port);
      }

      return db;
    }),

    // 💾 RTDB & Storage
    provideDatabase(() => {
      const db = getDatabase(getApp());

      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.database?.host &&
        cfg?.emulators?.database?.port;

      if (usingEmu) {
        connectDatabaseEmulator(db, cfg.emulators.database.host, cfg.emulators.database.port);
      }

      return db;
    }),

    provideStorage(() => {
      const storage = getStorage(getApp());

      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.storage?.host &&
        cfg?.emulators?.storage?.port;

      if (usingEmu) {
        connectStorageEmulator(storage, cfg.emulators.storage.host, cfg.emulators.storage.port);
      }

      return storage;
    }),

    // Erros & i18n
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
// - Derivar um estado único de acesso a partir de:
//   (1) AuthSessionService (verdade do Firebase Auth: uid, emailVerified, ready$)
//   (2) CurrentUserStoreService (verdade do app: role, profileCompleted, etc.)
//   (3) AuthAppBlockService (verdade do bloqueio do app: TerminateReason | null)
//   (4) Router (estado de navegação e rotas “sensíveis” para gating)
