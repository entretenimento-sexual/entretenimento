//src\app\register-module\auth-verification-handler\auth-verification-handler.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AuthVerificationHandlerComponent } from './auth-verification-handler.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { AuthService } from '../../core/services/autentication/auth.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { LoginService } from '../../core/services/autentication/login.service';
import { FirestoreService } from '../../core/services/data-handling/firestore.service';

describe('AuthVerificationHandlerComponent', () => {
  let fixture: ComponentFixture<AuthVerificationHandlerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthVerificationHandlerComponent, RouterTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParams: of({ mode: 'verifyEmail', oobCode: 'x' }) } },
        {
          provide: EmailVerificationService, useValue: {
            handleEmailVerification: () => of({ ok: true, reason: 'not-logged-in', firestoreUpdated: false }),
            resendVerificationEmail: () => of('ok'),
          }
        },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1' }), getLoggedUserUID$: () => of('u1') } },
        { provide: FirestoreUserQueryService, useValue: { getUser: () => of(null), updateUserInStateAndCache: () => { } } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: () => { } } },
        { provide: LoginService, useValue: { confirmPasswordReset: () => Promise.resolve() } },
        { provide: FirestoreService, useValue: { saveInitialUserData: () => of(void 0) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthVerificationHandlerComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
