// src/app/register-module/register.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';

import { RegisterComponent } from './register.component';
import { FirestoreValidationService } from '../core/services/data-handling/firestore/validation/firestore-validation.service';
import { RegisterService } from '../core/services/autentication/register/register.service';
import { EmailVerificationService } from '../core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from '../core/services/error-handler/error-notification.service';

class MockFirestoreValidationService {
  checkIfNicknameExists = vi.fn().mockReturnValue(of(false));
}

class MockRegisterService {
  registerUser = vi.fn().mockReturnValue(of(void 0));
}

class MockEmailVerificationService {
  resendVerificationEmail = vi.fn().mockReturnValue(of(void 0));
}

class MockErrorNotificationService {
  showError = vi.fn();
}

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;

  let registerService: MockRegisterService;
  let errorNotification: MockErrorNotificationService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RegisterComponent],
      imports: [ReactiveFormsModule, RouterTestingModule],
      providers: [
        { provide: FirestoreValidationService, useClass: MockFirestoreValidationService },
        { provide: RegisterService, useClass: MockRegisterService },
        { provide: EmailVerificationService, useClass: MockEmailVerificationService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: Auth, useValue: { currentUser: { uid: 'u-test' } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;

    registerService = TestBed.inject(RegisterService) as unknown as MockRegisterService;
    errorNotification = TestBed.inject(ErrorNotificationService) as unknown as MockErrorNotificationService;
    router = TestBed.inject(Router);

    vi.spyOn(router, 'navigate').mockResolvedValue(true);

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

  it('mantém o formulário inválido quando as senhas não coincidem', () => {
    component.form.patchValue({
      password: 'Senha123',
      confirmPassword: 'Outra123',
    });

    expect(component.form.hasError('passwordMismatch')).toBe(true);
    expect(component.getError('confirmPassword')).toBe(
      'As senhas não coincidem.'
    );
  });

  it('rejeita senha sem a complexidade mínima', () => {
    component.form.patchValue({
      password: '12345678',
      confirmPassword: '12345678',
    });

    expect(component.form.get('password')?.hasError('invalidPassword')).toBe(
      true
    );
  });

  it('deve chamar register e navegar quando o form estiver válido', async () => {
    component.form.patchValue({
      apelidoPrincipal: 'john',
      complementoApelido: 'doe',
      email: 'jd@example.com',
      password: 'Senha123',
      confirmPassword: 'Senha123',
      aceitarTermos: true,
    });

    component.onSubmit();

    await fixture.whenStable();

    expect(registerService.registerUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jd@example.com',
        nickname: expect.stringContaining('john'),
        acceptedTerms: expect.objectContaining({ accepted: true }),
        emailVerified: false,
      }),
      'Senha123'
    );

    expect(router.navigate).toHaveBeenCalledWith(
      ['/register/welcome'],
      { queryParams: { email: 'jd@example.com', autocheck: '1' }, replaceUrl: true }
    );
  });

  it('não envia a confirmação de senha ao serviço de registro', async () => {
    component.form.patchValue({
      apelidoPrincipal: 'maria',
      complementoApelido: '',
      email: 'maria@example.com',
      password: 'Segura123',
      confirmPassword: 'Segura123',
      aceitarTermos: true,
    });

    component.onSubmit();
    await fixture.whenStable();

    const [payload] = registerService.registerUser.mock.calls[0];
    expect(payload).not.toHaveProperty('confirmPassword');
  });

  it('alterna separadamente a visibilidade da senha e da confirmação', () => {
    const initialPassword = component.showPassword();
    const initialConfirmation = component.showConfirmPassword();

    component.togglePasswordVisibility();
    component.toggleConfirmPasswordVisibility();

    expect(component.showPassword()).toBe(!initialPassword);
    expect(component.showConfirmPassword()).toBe(!initialConfirmation);
  });
});
