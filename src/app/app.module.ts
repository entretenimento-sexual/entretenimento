//app.module.ts
import { NgModule, ErrorHandler } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireStorageModule } from '@angular/fire/compat/storage';
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
import { EmailVerificationService } from './core/services/autentication/Register/email-verification.service';

import { AngularPinturaModule } from '@pqina/angular-pintura';
import { userReducer } from './store/reducers/reducers.user/user.reducer';
import { UserEffects } from './store/effects/effects.user/user.effects';
import { AppStoreModule } from './store/store.module';

// Registro do idioma pt-BR
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { LOCALE_ID } from '@angular/core';
import { AuthEffects } from './store/effects/effects.user/auth.effects';

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
    AngularFireModule.initializeApp(environment.firebase),
    AngularFireStorageModule,
    AngularPinturaModule,
    StoreModule.forRoot({ user: userReducer }), // Configuração única do StoreModule
    EffectsModule.forRoot([AuthEffects, UserEffects]), // Configuração única do EffectsModule
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: environment.production }), // Configuração única do StoreDevtoolsModule
    AppStoreModule,
  ],
  providers: [
    AuthService,
    EmailVerificationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
