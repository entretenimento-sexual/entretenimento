// src/app/register-module/register.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { expect as jestExpect } from '@jest/globals';
import { RegisterComponent } from './register.component';
import { FirestoreValidationService } from '../core/services/data-handling/firestore-validation.service';
import { RegisterService } from '../core/services/autentication/register/register.service';
import { EmailVerificationService } from '../core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from '../core/services/error-handler/error-notification.service';
import { Auth } from '@angular/fire/auth'; // 👈 prover Auth

// Mocks simples
class MockFirestoreValidationService {
  checkIfNicknameExists = jest.fn().mockReturnValue(of(false));
}
class MockRegisterService {
  registerUser = jest.fn().mockReturnValue(of(void 0));
}
class MockEmailVerificationService {
  resendVerificationEmail = jest.fn().mockReturnValue(of(void 0));
}
class MockErrorNotificationService {
  showError = jest.fn();
}

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;

  let registerService: MockRegisterService;
  let emailVerification: MockEmailVerificationService;
  let errorNotification: MockErrorNotificationService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RegisterComponent], // NÃO é standalone
      imports: [ReactiveFormsModule, RouterTestingModule],
      providers: [
        { provide: FirestoreValidationService, useClass: MockFirestoreValidationService },
        { provide: RegisterService, useClass: MockRegisterService },
        { provide: EmailVerificationService, useClass: MockEmailVerificationService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        // 👇 garante que waitForAuthUserOnce resolva imediatamente
        { provide: Auth, useValue: { currentUser: { uid: 'u-test' } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;

    registerService = TestBed.inject(RegisterService) as any;
    emailVerification = TestBed.inject(EmailVerificationService) as any;
    errorNotification = TestBed.inject(ErrorNotificationService) as any;
    router = TestBed.inject(Router);

    jest.spyOn(router, 'navigate').mockResolvedValue(true as any);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve exibir erro e não chamar register quando o form estiver inválido', () => {
    component.onSubmit();

    expect(errorNotification.showError).toHaveBeenCalled();
    expect(registerService.registerUser).not.toHaveBeenCalled();
  });

  it('deve chamar register, verificar e navegar quando o form estiver válido', async () => {
    component.form.patchValue({
      apelidoPrincipal: 'john',
      complementoApelido: 'doe',
      email: 'jd@example.com',
      password: '123456',
      aceitarTermos: true,
    });

    component.onSubmit();

    // aguarda microtasks do await waitForAuthUserOnce + navigate
    await fixture.whenStable();

    expect(registerService.registerUser).toHaveBeenCalledWith(
      jestExpect.objectContaining({
        email: 'jd@example.com',
        nickname: jestExpect.stringContaining('john'),
        acceptedTerms: jestExpect.objectContaining({ accepted: true }),
        emailVerified: false,
      }),
      '123456'
    );

    expect(router.navigate).toHaveBeenCalledWith(
      ['/register/welcome'],
      { queryParams: { email: 'jd@example.com', autocheck: '1' }, replaceUrl: true }
    );
  });

  it('togglePasswordVisibility deve alternar o sinal', () => {
    const initial = component.showPassword();
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(!initial);
  });
});
