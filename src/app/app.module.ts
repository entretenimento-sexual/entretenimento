// app.module.ts
import { NgModule, ErrorHandler, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { environment } from '../environments/environment';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { MatDialogModule } from '@angular/material/dialog';
import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { AuthService } from './core/services/autentication/auth.service';
import { EmailVerificationService } from './core/services/autentication/register/email-verification.service';

import { AngularPinturaModule } from '@pqina/angular-pintura';
import { UserEffects } from './store/effects/effects.user/user.effects';
import { AppStoreModule } from './store/store.module';

// Firebase (versão moderna)
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';

// Registro do idioma pt-BR
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { LOCALE_ID } from '@angular/core';
import { AuthEffects } from './store/effects/effects.user/auth.effects';
import { reducers } from './store/reducers/reducers.user/combine.reducers';
import { RegisterModule } from './register-module/register.module';


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
    StoreModule.forRoot(reducers),
    EffectsModule.forRoot([AuthEffects, UserEffects]),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: environment.production }),
    AppStoreModule,
    RegisterModule,
  ],
  providers: [
    AuthService,
    EmailVerificationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },

    // ✅ Corrigindo Firebase sem erro de EnvironmentProviders
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
