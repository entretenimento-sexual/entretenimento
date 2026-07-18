// src/app/app.module.ts
// =============================================================================
// APP MODULE
//
// Responsabilidades deste módulo:
// - compor o bootstrap global da aplicação Angular
// - registrar módulos-base e providers transversais
// - delegar a infraestrutura Firebase para core/firebase
//
// A configuração detalhada de Auth, App Check, Firestore, Database, Storage,
// Functions e emuladores fica em firebase.providers.ts para evitar que o
// AppModule cresça junto com cada integração da plataforma.
// =============================================================================

import {
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

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { HeaderModule } from './header/header.module';
import { FooterModule } from './footer/footer.module';
import { AppStoreModule } from './store/store.module';
import { AdminLinkComponent } from './admin-dashboard/admin-link/admin-link.component';
import { FIREBASE_APPLICATION_PROVIDERS } from './core/firebase/firebase.providers';
import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';

registerLocaleData(localePt, 'pt-BR');

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
    AppStoreModule,
    AdminLinkComponent,
  ],

  providers: [
    ...FIREBASE_APPLICATION_PROVIDERS,
    GlobalErrorHandlerService,
    {
      provide: ErrorHandler,
      useExisting: GlobalErrorHandlerService,
    },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],

  bootstrap: [AppComponent],
})
export class AppModule {}
