// src/app/app.module.ts
// Não esqueça os comentáros explicativos.
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
import {  getAuth,
          initializeAuth,
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
          browserPopupRedirectResolver,
        } from 'firebase/auth';

// Firebase Web SDK (Firestore)
import { initializeFirestore, setLogLevel } from 'firebase/firestore';

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

/**
 * ✅ APP_INITIALIZER: segura o bootstrap “lógico” até o Firebase Auth restaurar a sessão.
 *
 * Por que isso importa?
 * - Sem isso, guards/Router podem rodar com auth.currentUser=null no boot (flash),
 *   causando redirecionamentos errados (/login) mesmo com usuário “logado” na persistência.
 */
export function authRestoreInitializer(auth: Auth) {
  return () => (auth as any).authStateReady?.() ?? Promise.resolve();
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
    { provide: APP_INITIALIZER, useFactory: authRestoreInitializer, deps: [Auth], multi: true },

    // 🔐 Auth (no emulador: só memória; em prod: persistência completa)
    provideAuth(() => {
      const app = getApp();
      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.auth?.host &&
        cfg?.emulators?.auth?.port;

      /**
       * ✅ Persistência:
       * - Emulador: browserSessionPersistence (não perde no refresh).
       *   (se você quiser “persistência total” no emulador, troque por indexedDBLocalPersistence.)
       * - Produção: todas as persistências (fallback automático do SDK).
       */
      const persistence = usingEmu
        ? [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]
        : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence];

      let auth;
      try {
        auth = initializeAuth(app, {
          persistence,
          popupRedirectResolver: browserPopupRedirectResolver,
        });
      } catch {
        // Caso o Auth já tenha sido inicializado em outro lugar, reaproveita instância
        auth = getAuth(app);
      }

      if (usingEmu) {
        const url = `http://${cfg.emulators.auth.host}:${cfg.emulators.auth.port}`;
        connectAuthEmulator(auth, url, { disableWarnings: true });

        // log não-bloqueante (ignora CORS)
        try { fetch(url, { mode: 'no-cors' }).catch(() => { }); } catch { }

        //try { (window as any).DBG?.('[AUTH][EMU-CONNECTED]', { url }); } catch { }
      }

      return auth;
    }),


    // 🗄️ Firestore (long-polling + emulador)
    provideFirestore(() => {
      // ✅ garante silêncio (ou troque para 'error' se quiser ver só erros)
      //setLogLevel(environment.production ? 'error' : 'silent');

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
        //try { (window as any).DBG?.('[FS][EMU-CONNECTED]', cfg.emulators.firestore); } catch { }
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
       // try { (window as any).DBG?.('[RTDB][EMU-CONNECTED]', cfg.emulators.database); } catch { }
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
      //  try { (window as any).DBG?.('[ST][EMU-CONNECTED]', cfg.emulators.storage); } catch { }
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
