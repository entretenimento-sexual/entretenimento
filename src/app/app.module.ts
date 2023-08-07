// app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';

// Módulos do seu projeto
import { HomeModule } from './home/home.module';
import { PublicContentModule } from './public-content/public-content.module';
import { ExplorationModule } from './exploration/exploration.module';
import { CommunityModule } from './community/community.module';
import { ContactSupportModule } from './contact-support/contact-support.module';
import { UserProfileModule } from './user-profile/user-profile.module';
import { HeaderModule } from './core/header/header.module';
import { FooterModule } from './core/footer/footer.module';

// Serviços do seu projeto
import { AuthService } from './core/services/autentication/auth.service';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

import { environment } from '../environments/environment';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ExtaseGuard } from './guards/extase.guard';



@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    HomeModule,
    UserProfileModule,
    PublicContentModule,
    ExplorationModule,
    CommunityModule,
    ContactSupportModule,
    HeaderModule, // O HeaderModule importa os componentes do header
    FooterModule, // O FooterModule importa os componentes do footer
    AngularFireModule.initializeApp(environment.firebaseConfig), // Inicialização do Firebase
    AngularFirestoreModule, // Importação do Firestore
    AngularFireAuthModule,
    AngularFireDatabaseModule
  ],
  providers: [
    AuthService,
    ExtaseGuard,
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
