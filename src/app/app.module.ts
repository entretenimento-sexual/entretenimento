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

// Firebase
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

import { environment } from '../environments/environment';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LogoComponent } from './core/header/logo/logo.component';
import { NavbarComponent } from './core/header/navbar/navbar.component';
import { SearchComponent } from './core/header/search/search.component';
import { UserIconComponent } from './core/header/user-icon/user-icon.component';
import { HeaderComponent } from './core/header/header.component';

@NgModule({
  declarations: [
    AppComponent,
    LogoComponent,
    NavbarComponent,
    SearchComponent,
    UserIconComponent,
    HeaderComponent
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
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
  ],
  providers: [
    AuthService
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
