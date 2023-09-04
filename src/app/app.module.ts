// app.module.ts
// Importações do Angular
import { NgModule } from '@angular/core';
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
import { UserProfileModule } from './user-profile/user-profile.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { LayoutModule } from './layout/layout.module';
import { HeaderModule } from './header/header.module';
import { PostVerificationModule } from './post-verification/post-verification.module';

// Importações de serviços, guards e outros elementos específicos do projeto
import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { AuthService } from './core/services/autentication/auth.service';

import { AuthenticationTestComponent } from './authentication-test/authentication-test.component';
import { FooterModule } from './footer/footer.module';
import { EmailVerificationService } from './core/services/autentication/email-verification.service';


@NgModule({
  declarations: [AppComponent, AuthenticationTestComponent],
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
    LayoutModule,
    FooterModule

    //
  ],
  providers: [
    // Serviços, guards e outros elementos específicos
    AuthService, EmailVerificationService


  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
