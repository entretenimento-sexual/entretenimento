// app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

// Módulos do seu projeto
import { HomeModule } from './home/home.module';
import { PublicContentModule } from './public-content/public-content.module';
import { ExplorationModule } from './exploration/exploration.module';
import { CommunityModule } from './community/community.module';
import { ContactSupportModule } from './contact-support/contact-support.module';

// Serviços do seu projeto
import { AuthService } from './core/services/autentication/auth.service';

import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

// Firebase
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

import { environment } from '../environments/environment';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { FooterModule } from './core/footer/footer.module';
import { HeaderModule } from './core/header/header.module'; // Correção aqui

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    HomeModule,
    PublicContentModule,
    ExplorationModule,
    CommunityModule,
    ContactSupportModule,
    HeaderModule, // O HeaderModule importa os componentes do header
    FooterModule, // O FooterModule importa os componentes do footer
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
  ],
  providers: [
    AuthService,
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
