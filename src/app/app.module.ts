// src/app/app.module.ts
import { NgModule, ErrorHandler, LOCALE_ID, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { MatDialogModule } from '@angular/material/dialog';
import { AngularPinturaModule } from '@pqina/angular-pintura';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';

import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { AppStoreModule } from './store/store.module';
import { AuthEffects } from './store/effects/effects.user/auth.effects';
import { UserEffects } from './store/effects/effects.user/user.effects';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { AuthService } from './core/services/autentication/auth.service';
import { EmailVerificationService } from './core/services/autentication/register/email-verification.service';

import { environment } from '../environments/environment';

// 🔥 AngularFire (compat) — mantém para módulos que ainda usam compat
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireStorageModule } from '@angular/fire/compat/storage';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';

// ✅ Inicialização única/antecipada via DI (modular SDK)
import { provideFirebase } from './core/firebase/firebase.factory';
import { FIREBASE_APP, FIREBASE_AUTH } from './core/firebase/firebase.tokens';
import type { Auth } from 'firebase/auth';
import { configureAuthPersistence } from './core/firebase/firebase.factory';

// i18n pt-BR
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
registerLocaleData(localePt, 'pt-BR');

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    HeaderModule,
    FooterModule,
    AuthenticationModule,
    BrowserAnimationsModule,
    MatDialogModule,
    PhotoEditorModule,
    AngularPinturaModule,

    EffectsModule.forRoot([AuthEffects, UserEffects]),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: environment.production }),
    AppStoreModule,

    // ⚠️ Mantido: compat modules que seu app já utiliza
    AngularFireModule.initializeApp(environment.firebase),
    AngularFireAuthModule,
    AngularFirestoreModule,
    AngularFireStorageModule,
    AngularFireDatabaseModule,
  ],
  providers: [
    // ✅ cria/fornece App, Auth e Firestore 1x (e reaproveita se já houver)
    ...provideFirebase(),

    // ✅ garante que o Firebase App exista antes do bootstrap (evita race)
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [FIREBASE_APP],
      useFactory: () => () => {
        const f = (environment as any)?.firebase ?? {};
        if (!f.apiKey || !f.projectId) throw new Error('[Firebase] environment.firebase incompleto');
        return Promise.resolve(true);
      },
    },

    // ✅ garante persistência (IndexedDB → LocalStorage → memória) ANTES do primeiro onAuthStateChanged
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [FIREBASE_AUTH],
      useFactory: (auth: Auth) => () => configureAuthPersistence(auth),
    },

    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    AuthService,              // (já é providedIn: 'root' — manter não quebra)
    EmailVerificationService, // idem
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
