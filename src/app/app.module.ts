// src/app/app.module.ts
import { NgModule, ErrorHandler, LOCALE_ID, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { MatDialogModule } from '@angular/material/dialog';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';

import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { AppStoreModule } from './store/store.module';
import { AuthEffects } from './store/effects/effects.user/auth.effects';
import { UserEffects } from './store/effects/effects.user/user.effects';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { environment } from '../environments/environment';

// AngularFire providers (em providers, não em imports!)
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { connectAuthEmulator, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, provideFirestore } from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';
import { provideStorage } from '@angular/fire/storage';

// Firebase SDK
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, browserPopupRedirectResolver, browserSessionPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

// i18n
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
registerLocaleData(localePt, 'pt-BR');

// espera de sessão
import { AuthSessionService } from './core/services/autentication/auth/auth-session.service';
import { AdminLinkComponent } from "./admin-dashboard/admin-link/admin-link.component";
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';

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
    HttpClientModule,
    ReactiveFormsModule,
    BrowserAnimationsModule,
    MatDialogModule,
    HeaderModule,
    FooterModule,
    PhotoEditorModule,
    EffectsModule.forRoot([AuthEffects, UserEffects]),
    AppStoreModule,
    ...(environment.production ? [] : [StoreDevtoolsModule.instrument({ maxAge: 25 })]),
    AdminLinkComponent
],

  providers: [
    // Firebase
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const app = getApp();
      // initializeAuth só pode ser chamado uma vez
      try {
        const auth = initializeAuth(app, {
          persistence: [indexedDBLocalPersistence,
                        browserLocalPersistence,
                        browserSessionPersistence,
                        inMemoryPersistence
                      ],
          popupRedirectResolver: browserPopupRedirectResolver,
        });

        // (opcional) emulador de Auth
        const cfg: any = environment;
        const emu = cfg?.emulators?.auth;
        if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
          // Import: connectAuthEmulator de '@angular/fire/auth'
          // import { connectAuthEmulator } from '@angular/fire/auth';
          connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
        }

        return auth;
      } catch {
        // Já inicializado (HMR). Só retorna a instância existente e conecta emulador se preciso.
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

    // 🔒 Espera a restauração do Auth antes da 1ª navegação
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
