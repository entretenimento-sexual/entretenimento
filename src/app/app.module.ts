// src/app/app.module.ts
import { NgModule, ErrorHandler, LOCALE_ID } from '@angular/core';
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
import { provideAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';

// Firebase Web SDK (Auth)
import {  getAuth,
          initializeAuth,
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
          inMemoryPersistence,
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

    // 🔐 Auth (no emulador: só memória; em prod: persistência completa)
    provideAuth(() => {
      const app = getApp();
      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.auth?.host &&
        cfg?.emulators?.auth?.port;

      const persistence = usingEmu
        ? [inMemoryPersistence] // evita refresh token inválido no emulador
        : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence];

      let auth;
      try {
        auth = initializeAuth(app, { persistence, popupRedirectResolver: browserPopupRedirectResolver });
      } catch {
        auth = getAuth(app);
      }

      if (usingEmu) {
        const url = `http://${cfg.emulators.auth.host}:${cfg.emulators.auth.port}`;
        connectAuthEmulator(auth, url, { disableWarnings: true });
        // log não-bloqueante (ignora CORS):
        try { fetch(url, { mode: 'no-cors' }).catch(() => { }); } catch { }
        console.log('[AUTH][EMU-CONNECTED]', { url });
      }

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

      if (!environment.production) setLogLevel('debug');

      const cfg: any = environment;
      const usingEmu =
        !environment.production &&
        cfg?.useEmulators &&
        cfg?.emulators?.firestore?.host &&
        cfg?.emulators?.firestore?.port;

      if (usingEmu) {
        connectFirestoreEmulator(db, cfg.emulators.firestore.host, cfg.emulators.firestore.port);
        console.log('[FS][EMU-CONNECTED]', cfg.emulators.firestore);
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
        console.log('[RTDB][EMU-CONNECTED]', cfg.emulators.database);
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
        console.log('[ST][EMU-CONNECTED]', cfg.emulators.storage);
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
