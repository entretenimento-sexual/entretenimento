// app.module.ts
import { ErrorHandler, NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { HeaderModule } from './header/header.module';
import { PostVerificationModule } from './post-verification/post-verification.module';
import { FooterModule } from './footer/footer.module';

import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { AuthService } from './core/services/autentication/auth.service';
import { EmailVerificationService } from './core/services/autentication/email-verification.service';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { UserProfileModule } from './user-profile/user-profile.module';

import { MatDialogModule } from '@angular/material/dialog';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { GlobalErrorHandler } from './core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';

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
    UserProfileModule,
    BrowserAnimationsModule,
    MatDialogModule,
    StoreModule.forRoot({}, {}),
    EffectsModule.forRoot([]),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: !isDevMode() }),
  ],
  providers: [
    AuthService,
    EmailVerificationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    ErrorNotificationService,
    provideAnimationsAsync()
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
