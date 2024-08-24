//app.module.ts
import { NgModule, ErrorHandler } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireStorageModule } from '@angular/fire/compat/storage'; // Importa o módulo de storage
import { environment } from '../environments/environment'; // Certifique-se de que o caminho está correto

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { PostVerificationModule } from './post-verification/post-verification.module';
import { FooterModule } from './footer/footer.module';
import { UserProfileModule } from './user-profile/user-profile.module';
import { MatDialogModule } from '@angular/material/dialog';
import { GlobalErrorHandler } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { PhotoEditorModule } from './photo-editor/photo-editor.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { AuthService } from './core/services/autentication/auth.service';
import { EmailVerificationService } from './core/services/autentication/email-verification.service';



@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    PostVerificationModule,
    HeaderModule,
    FooterModule,
    AuthenticationModule,
    BrowserAnimationsModule,
    MatDialogModule,
    StoreModule.forRoot({}, {}),
    EffectsModule.forRoot([]),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: !environment.production }),
    PhotoEditorModule,
    AngularFireModule.initializeApp(environment.firebase), // Inicializa o Firebase com as configurações do seu ambiente
    AngularFireStorageModule, // Importa o módulo de armazenamento do Firebase
    
  ],
  providers: [
    AuthService,
    EmailVerificationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    ErrorNotificationService
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
