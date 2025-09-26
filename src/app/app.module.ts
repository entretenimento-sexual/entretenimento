// src/app/app.module.ts
import { NgModule, ErrorHandler, LOCALE_ID } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { MatDialogModule } from '@angular/material/dialog';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

// (opcional) módulos de feature — se ainda não estiverem em lazy
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

// AngularFire (modular)
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { provideDatabase } from '@angular/fire/database';
import { provideStorage } from '@angular/fire/storage';

// Firebase Web SDK
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

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
    BrowserAnimationsModule,
    MatDialogModule,

    // se não estiver em lazy ainda
    HeaderModule,
    FooterModule,
    PhotoEditorModule,

    EffectsModule.forRoot([AuthEffects, UserEffects]),
    AppStoreModule,

    // só em dev
    ...(environment.production ? [] : [StoreDevtoolsModule.instrument({ maxAge: 25 })]),
  ],
  providers: [
    // ===== Firebase (modular) — AQUI
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const app = getApp();
      try {
        return initializeAuth(app, {
          persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
        });
      } catch {
        // se já foi inicializado (HMR/testes)
        return getAuth(app);
      }
    }),
    provideFirestore(() => getFirestore(getApp())),
    provideDatabase(() => getDatabase(getApp())),
    provideStorage(() => getStorage(getApp())),

    // ===== Erros e i18n
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    ErrorNotificationService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
