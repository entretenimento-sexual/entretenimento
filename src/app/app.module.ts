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
  inject,
  provideAppInitializer,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { FooterModule } from './footer/footer.module';
import { AppStoreModule } from './store/store.module';
import { GlobalNetworkStatusComponent } from './core/components/global-network-status/global-network-status.component';
import { FIREBASE_APPLICATION_PROVIDERS } from './core/firebase/firebase.providers';
import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import {
  CACHE_MAINTENANCE_AUTO_START,
  CacheMaintenanceService,
} from './core/services/general/cache/cache-maintenance.service';

registerLocaleData(localePt, 'pt-BR');

@NgModule({
  declarations: [AppComponent],

  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    BrowserAnimationsModule,
    MatDialogModule,
    MatSnackBarModule,
    FooterModule,
    AppStoreModule,
    GlobalNetworkStatusComponent,
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
    provideAppInitializer(() => {
      if (inject(CACHE_MAINTENANCE_AUTO_START)) {
        inject(CacheMaintenanceService).scheduleOncePerSession();
      }
    }),
  ],

  bootstrap: [AppComponent],
})
export class AppModule {}
