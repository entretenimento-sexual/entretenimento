// app.module.ts
import { NgModule, ErrorHandler, LOCALE_ID, inject } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { MatDialogModule } from '@angular/material/dialog';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';

import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { EffectsModule } from '@ngrx/effects';
import { AppStoreModule } from './store/store.module';
import { UserEffects } from './store/effects/effects.user/user.effects';
import { AuthEffects } from './store/effects/effects.user/auth.effects';

import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { AuthService } from './core/services/autentication/auth.service';
import { EmailVerificationService } from './core/services/autentication/register/email-verification.service';

import { AngularPinturaModule } from '@pqina/angular-pintura';
import { environment } from '../environments/environment';

// AngularFire v20
import { FirebaseApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getDatabase, provideDatabase } from '@angular/fire/database';

// i18n
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
  ],
  providers: [
    AuthService,
    EmailVerificationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },

    // ⚠️ Forçando dependência explícita do app:
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const app = inject(FirebaseApp);
      return getAuth(app);
    }),
    provideFirestore(() => {
      const app = inject(FirebaseApp);
      return getFirestore(app);
    }),
    provideStorage(() => {
      const app = inject(FirebaseApp);
      return getStorage(app);
    }),
    provideDatabase(() => {
      const app = inject(FirebaseApp);
      return getDatabase(app);
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
