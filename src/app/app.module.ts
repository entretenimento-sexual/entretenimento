// app.module.ts
// Importações do Angular
import { NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

// Configuração e importações do AngularFire
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideDatabase, getDatabase } from '@angular/fire/database';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideStorage, getStorage } from '@angular/fire/storage';

// Importações de módulos do projeto
import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { PostVerificationModule } from './post-verification/post-verification.module';
import { FooterModule } from './footer/footer.module';

// Importações de serviços, guards e outros elementos específicos do projeto
import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { AuthService } from './core/services/autentication/auth.service';

import { EmailVerificationService } from './core/services/autentication/email-verification.service';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { UserProfileModule } from './user-profile/user-profile.module';

//AngularMaterial
import { MatDialogModule } from '@angular/material/dialog';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';

@NgModule({
  declarations: [AppComponent],
  imports: [
    // Importações do Angular
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    PostVerificationModule,

    // Configuração do AngularFire
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideDatabase(() => getDatabase()),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
    HeaderModule,
    PostVerificationModule,
    AuthenticationModule,
    UserProfileModule,
    FooterModule,
    BrowserAnimationsModule,

      //AngularMaterial
    MatDialogModule,

      StoreModule.forRoot({}, {}),

      EffectsModule.forRoot([]),

      StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: !isDevMode() }),
  ],
  providers: [
    // Serviços, guards e outros elementos específicos
    AuthService, EmailVerificationService, provideAnimationsAsync()
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
