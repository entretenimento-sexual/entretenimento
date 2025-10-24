// src/app/app.module.ts
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

// AngularFire providers (FICAM EM PROVIDERS num NgModule)
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';
import { provideStorage } from '@angular/fire/storage';

// Firebase SDK (para configurar initializeAuth etc.)
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

// i18n
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
registerLocaleData(localePt, 'pt-BR');

// sessão / orquestrador
import { AuthSessionService } from './core/services/autentication/auth/auth-session.service';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';

// standalone comp
import { AdminLinkComponent } from './admin-dashboard/admin-link/admin-link.component';

function authReadyInitializer(session: AuthSessionService) {
  return () => session.whenReady();
}
function startOrchestratorAfterReady(session: AuthSessionService, orchestrator: AuthOrchestratorService) {
  return async () => { await session.whenReady(); orchestrator.start(); };
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

    ...(environment.production ? [] : [StoreDevtoolsModule.instrument({ maxAge: 25 })]),

    // standalone component pode ficar em imports
    AdminLinkComponent,
  ],
  providers: [
    // 🔥 AngularFire — em providers (não em imports) quando usando NgModule
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const app = getApp();
      try {
        const auth = initializeAuth(app, {
          persistence: [
            indexedDBLocalPersistence,
            browserLocalPersistence,
            browserSessionPersistence,
            inMemoryPersistence,
          ],
          popupRedirectResolver: browserPopupRedirectResolver,
        });
        const cfg: any = environment;
        const emu = cfg?.emulators?.auth;
        if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
          connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
        }
        return auth;
      } catch {
        const auth = getAuth(app);
        const cfg: any = environment;
        const emu = cfg?.emulators?.auth;
        if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
          connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
        }
        return auth;
      }
    }),
    provideFirestore(() => {
      const db = getFirestore(getApp());
      const cfg: any = environment;
      const emu = cfg?.emulators?.firestore;
      if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
        connectFirestoreEmulator(db, emu.host, emu.port);
      }
      return db;
    }),
    provideDatabase(() => getDatabase(getApp())),
    provideStorage(() => getStorage(getApp())),

    // Inicializadores
    { provide: APP_INITIALIZER, useFactory: authReadyInitializer, deps: [AuthSessionService], multi: true },
    { provide: APP_INITIALIZER, useFactory: startOrchestratorAfterReady, deps: [AuthSessionService, AuthOrchestratorService], multi: true },

    // Erros e i18n
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
