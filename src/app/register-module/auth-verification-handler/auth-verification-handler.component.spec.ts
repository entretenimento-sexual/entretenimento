// src/app/register-module/auth-verification-handler/auth-verification-handler.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NgZone } from '@angular/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { PasswordResetCodeValidationService } from '../../core/services/autentication/password-reset-code-validation.service';
import { LoginService } from '../../core/services/autentication/login.service';
import {
  EmailInputModalService,
  type PasswordRecoveryModalState,
} from '../../core/services/autentication/email-input-modal.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { AuthVerificationHandlerComponent } from './auth-verification-handler.component';

describe('AuthVerificationHandlerComponent', () => {
  let fixture: ComponentFixture<AuthVerificationHandlerComponent>;
  let component: AuthVerificationHandlerComponent;

  let queryParamsSubject: BehaviorSubject<Record<string, string>>;

  let routerMock: {
    navigate: Mock;
  };

  let emailVerificationMock: {
    handleEmailVerification: Mock;
    resendVerificationEmail: Mock;
  };

  let passwordResetValidationMock: {
    validate$: Mock;
  };

  let loginServiceMock: {
    confirmPasswordReset$: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  let emailInputModalMock: {
    state$: BehaviorSubject<PasswordRecoveryModalState>;
    isModalOpen: Subject<boolean>;
    emailSentMessage: Subject<string>;
    openModal: Mock;
    closeModal: Mock;
    updateEmail: Mock;
    sendPasswordRecoveryEmail: Mock;
  };

  beforeEach(async () => {
    queryParamsSubject = new BehaviorSubject<Record<string, string>>({});

    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    emailVerificationMock = {
      handleEmailVerification: vi.fn(),
      resendVerificationEmail: vi.fn(),
    };

    passwordResetValidationMock = {
      validate$: vi.fn().mockReturnValue(
        of({
          ok: true,
          reason: 'valid',
          email: 'user@example.com',
          message: 'Link válido.',
        })
      ),
    };

    loginServiceMock = {
      confirmPasswordReset$: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    emailInputModalMock = {
      state$: new BehaviorSubject<PasswordRecoveryModalState>({
        isOpen: false,
        email: '',
        isSending: false,
        requestCompleted: false,
        submittedEmail: null,
        isLocalDev: true,
        feedback: null,
      }),
      isModalOpen: new Subject<boolean>(),
      emailSentMessage: new Subject<string>(),
      openModal: vi.fn(),
      closeModal: vi.fn(),
      updateEmail: vi.fn(),
      sendPasswordRecoveryEmail: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AuthVerificationHandlerComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParamsSubject.asObservable(),
          },
        },
        { provide: Router, useValue: routerMock },
        {
          provide: NgZone,
          useValue: new NgZone({ enableLongStackTrace: false }),
        },
        { provide: EmailVerificationService, useValue: emailVerificationMock },
        {
          provide: PasswordResetCodeValidationService,
          useValue: passwordResetValidationMock,
        },
        { provide: LoginService, useValue: loginServiceMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
        { provide: EmailInputModalService, useValue: emailInputModalMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthVerificationHandlerComponent);
    component = fixture.componentInstance;

    vi.clearAllMocks();
    passwordResetValidationMock.validate$.mockReturnValue(
      of({
        ok: true,
        reason: 'valid',
        email: 'user@example.com',
        message: 'Link válido.',
      })
    );
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve exibir ação desconhecida quando não houver mode', () => {
    fixture.detectChanges();

    expect(component.isLoading).toBe(false);
    expect(component.message).toBe('Ação desconhecida.');
  });

  it('deve exibir erro quando mode vier sem oobCode', () => {
    queryParamsSubject.next({ mode: 'verifyEmail' });
    fixture.detectChanges();

    expect(component.isLoading).toBe(false);
    expect(component.message).toBe('Código inválido ou ausente.');
  });

  it('deve oferecer novo link quando resetPassword vier sem oobCode', () => {
    queryParamsSubject.next({ mode: 'resetPassword' });
    fixture.detectChanges();

    expect(component.passwordResetUnavailable).toBe(true);
    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.message).toBe('Código inválido ou ausente.');
    expect(passwordResetValidationMock.validate$).not.toHaveBeenCalled();
  });

  it('deve processar verificação de e-mail com sucesso', () => {
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({
        ok: true,
        reason: 'verified',
        firestoreUpdated: true,
      })
    );

    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'abc123' });
    fixture.detectChanges();

    expect(emailVerificationMock.handleEmailVerification).toHaveBeenCalledTimes(1);
    expect(component.verifyOk).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(component.message).toBe('E-mail verificado com sucesso.');
    expect(component.showResendVerifyCTA).toBe(false);
  });

  it('deve oferecer reenvio quando link de verificação estiver expirado', () => {
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({ ok: false, reason: 'expired' })
    );

    queryParamsSubject.next({
      mode: 'verifyEmail',
      oobCode: 'expired-code',
    });
    fixture.detectChanges();

    expect(component.verifyOk).toBe(false);
    expect(component.showResendVerifyCTA).toBe(true);
    expect(component.message).toBe(
      'O link de verificação expirou. Reenvie um novo e-mail.'
    );
  });

  it('valida o link antes de exibir o formulário de nova senha', () => {
    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });
    fixture.detectChanges();

    expect(passwordResetValidationMock.validate$).toHaveBeenCalledWith(
      'reset-code'
    );
    expect(component.passwordResetCodeValidated).toBe(true);
    expect(component.passwordResetTargetEmail).toBe('user@example.com');
    expect(component.isLoading).toBe(false);
    expect(loginServiceMock.confirmPasswordReset$).not.toHaveBeenCalled();
  });

  it('bloqueia o formulário imediatamente quando o link já expirou', () => {
    passwordResetValidationMock.validate$.mockReturnValue(
      of({
        ok: false,
        reason: 'expired',
        message: 'O link de redefinição de senha expirou.',
      })
    );

    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'expired-code',
    });
    fixture.detectChanges();

    expect(component.passwordResetCodeValidated).toBe(false);
    expect(component.passwordResetUnavailable).toBe(true);
    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.passwordResetValidationRetryAvailable).toBe(false);
    expect(component.message).toBe(
      'O link de redefinição de senha expirou.'
    );
  });

  it('permite repetir a validação após falha operacional', () => {
    passwordResetValidationMock.validate$
      .mockReturnValueOnce(
        of({
          ok: false,
          reason: 'unavailable',
          message: 'Não foi possível validar o link agora.',
        })
      )
      .mockReturnValueOnce(
        of({
          ok: true,
          reason: 'valid',
          email: 'user@example.com',
          message: 'Link válido.',
        })
      );

    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });
    fixture.detectChanges();

    expect(component.passwordResetValidationRetryAvailable).toBe(true);

    component.retryPasswordResetValidation();

    expect(passwordResetValidationMock.validate$).toHaveBeenCalledTimes(2);
    expect(component.passwordResetCodeValidated).toBe(true);
    expect(component.passwordResetValidationRetryAvailable).toBe(false);
  });

  it('redefine a senha depois da validação prévia', async () => {
    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });
    fixture.detectChanges();

    loginServiceMock.confirmPasswordReset$.mockReturnValue(of(void 0));
    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'SenhaSegura123';

    await component.resetPassword();

    expect(loginServiceMock.confirmPasswordReset$).toHaveBeenCalledWith(
      'reset-code',
      'SenhaSegura123'
    );
    expect(component.passwordResetOk).toBe(true);
    expect(component.passwordResetCompleted).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(component.message).toBe(
      'Senha redefinida com sucesso. Redirecionando para o login...'
    );
  });

  it('informa erro quando as senhas não coincidirem', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.passwordResetCodeValidated = true;
    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'OutraSenha123';

    await component.resetPassword();

    expect(component.message).toBe('As senhas não coincidem.');
    expect(component.passwordResetOk).toBe(false);
    expect(loginServiceMock.confirmPasswordReset$).not.toHaveBeenCalled();
  });

  it('aplica a mesma política de senha usada no cadastro', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.passwordResetCodeValidated = true;
    component.newPassword = '12345678';
    component.confirmPassword = '12345678';

    await component.resetPassword();

    expect(component.message).toBe(
      'Use ao menos 8 caracteres, com letra maiúscula, minúscula e número.'
    );
    expect(loginServiceMock.confirmPasswordReset$).not.toHaveBeenCalled();
  });

  it('bloqueia o formulário se o código expirar entre validação e confirmação', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.passwordResetCodeValidated = true;
    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'SenhaSegura123';

    loginServiceMock.confirmPasswordReset$.mockReturnValue(
      throwError(() => ({ code: 'auth/expired-action-code' }))
    );

    await component.resetPassword();

    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.passwordResetUnavailable).toBe(true);
    expect(component.passwordResetCodeValidated).toBe(false);
    expect(component.passwordResetOk).toBe(false);
    expect(component.message).toBe(
      'O link de redefinição de senha expirou.'
    );
    expect(globalErrorMock.handleError).not.toHaveBeenCalled();
  });

  it('encaminha falha técnica da confirmação ao handler global sem duplicar feedback', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.passwordResetCodeValidated = true;
    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'SenhaSegura123';

    loginServiceMock.confirmPasswordReset$.mockReturnValue(
      throwError(() => ({ code: 'auth/network-request-failed' }))
    );

    await component.resetPassword();

    expect(component.passwordResetUnavailable).toBe(false);
    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.message).toBe(
      'Não foi possível redefinir a senha agora. Tente novamente.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);

    const reportedError = globalErrorMock.handleError.mock.calls[0][0] as Error & {
      skipUserNotification?: boolean;
    };
    expect(reportedError.skipUserNotification).toBe(true);
  });

  it('deve abrir modal de recuperação de senha', () => {
    component.openPasswordRecoveryModal();

    expect(emailInputModalMock.openModal).toHaveBeenCalledTimes(1);
  });
});
