// src/app/register-module/auth-verification-handler/auth-verification-handler.component.spec.ts
// Testes do AuthVerificationHandlerComponent
//
// Ajustes desta versão:
// - remove testes legados de finishRegistration;
// - remove dependências de FirestoreUserWriteService, FirestoreUserQueryService e CurrentUserStoreService;
// - valida a responsabilidade atual do componente: verificação de e-mail e reset de senha.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NgZone } from '@angular/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  EmailVerificationService,
} from '../../core/services/autentication/register/email-verification.service';

import { LoginService } from '../../core/services/autentication/login.service';

import { EmailInputModalService } from '../../core/services/autentication/email-input-modal.service';

import { AuthVerificationHandlerComponent } from './auth-verification-handler.component';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

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

  let loginServiceMock: {
    confirmPasswordReset$: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  let emailInputModalMock: {
    isModalOpen: Subject<boolean>;
    emailSentMessage: Subject<string>;
    openModal: Mock;
    closeModal: Mock;
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

    loginServiceMock = {
      confirmPasswordReset$: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    emailInputModalMock = {
      isModalOpen: new Subject<boolean>(),
      emailSentMessage: new Subject<string>(),
      openModal: vi.fn(),
      closeModal: vi.fn(),
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
        { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
        { provide: EmailVerificationService, useValue: emailVerificationMock },
        { provide: LoginService, useValue: loginServiceMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
        { provide: EmailInputModalService, useValue: emailInputModalMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthVerificationHandlerComponent);
    component = fixture.componentInstance;

    vi.clearAllMocks();
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
    queryParamsSubject.next({
      mode: 'verifyEmail',
    });

    fixture.detectChanges();

    expect(component.isLoading).toBe(false);
    expect(component.message).toBe('Código inválido ou ausente.');
  });

  it('deve oferecer novo link quando resetPassword vier sem oobCode', () => {
    queryParamsSubject.next({
      mode: 'resetPassword',
    });

    fixture.detectChanges();

    expect(component.passwordResetUnavailable).toBe(true);
    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.message).toBe('Código inválido ou ausente.');
  });

  it('deve processar verificação de e-mail com sucesso', () => {
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({
        ok: true,
        reason: 'verified',
        firestoreUpdated: true,
      })
    );

    queryParamsSubject.next({
      mode: 'verifyEmail',
      oobCode: 'abc123',
    });

    fixture.detectChanges();

    expect(emailVerificationMock.handleEmailVerification).toHaveBeenCalledTimes(1);
    expect(component.verifyOk).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(component.message).toBe('E-mail verificado com sucesso.');
    expect(component.showResendVerifyCTA).toBe(false);
  });

  it('deve oferecer reenvio quando link de verificação estiver expirado', () => {
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({
        ok: false,
        reason: 'expired',
      })
    );

    queryParamsSubject.next({
      mode: 'verifyEmail',
      oobCode: 'expired-code',
    });

    fixture.detectChanges();

    expect(component.verifyOk).toBe(false);
    expect(component.showResendVerifyCTA).toBe(true);
    expect(component.message).toBe('O link de verificação expirou. Reenvie um novo e-mail.');
  });

  it('deve preparar tela de resetPassword sem executar reset automaticamente', () => {
    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });

    fixture.detectChanges();

    expect(component.mode).toBe('resetPassword');
    expect(component.oobCode).toBe('reset-code');
    expect(component.isLoading).toBe(false);
    expect(component.passwordResetUnavailable).toBe(false);
    expect(loginServiceMock.confirmPasswordReset$).not.toHaveBeenCalled();
  });

  it('deve redefinir senha e encerrar o formulário quando as senhas forem válidas', async () => {
    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });

    fixture.detectChanges();

    loginServiceMock.confirmPasswordReset$.mockReturnValue(of(void 0));

    component.newPassword = 'senhaSegura123';
    component.confirmPassword = 'senhaSegura123';

    await component.resetPassword();

    expect(loginServiceMock.confirmPasswordReset$).toHaveBeenCalledWith(
      'reset-code',
      'senhaSegura123'
    );

    expect(component.passwordResetOk).toBe(true);
    expect(component.passwordResetCompleted).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(component.message).toBe(
      'Senha redefinida com sucesso. Redirecionando para o login...'
    );
  });

  it('deve informar erro quando as senhas não coincidirem', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.newPassword = 'senhaSegura123';
    component.confirmPassword = 'outraSenha123';

    await component.resetPassword();

    expect(component.message).toBe('As senhas não coincidem.');
    expect(component.passwordResetOk).toBe(false);
    expect(loginServiceMock.confirmPasswordReset$).not.toHaveBeenCalled();
  });

  it('deve bloquear formulário e exibir recuperação quando o código estiver expirado', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.newPassword = 'senhaSegura123';
    component.confirmPassword = 'senhaSegura123';

    loginServiceMock.confirmPasswordReset$.mockReturnValue(
      throwError(() => ({ code: 'auth/expired-action-code' }))
    );

    await component.resetPassword();

    expect(component.shouldShowRecoveryLink).toBe(true);
    expect(component.passwordResetUnavailable).toBe(true);
    expect(component.passwordResetOk).toBe(false);
    expect(component.message).toBe('O link de redefinição de senha expirou.');
    expect(globalErrorMock.handleError).not.toHaveBeenCalled();
  });

  it('deve encaminhar falha técnica do reset ao handler global sem duplicar feedback', async () => {
    component.mode = 'resetPassword';
    component.oobCode = 'reset-code';
    component.isLoading = false;
    component.newPassword = 'senhaSegura123';
    component.confirmPassword = 'senhaSegura123';

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
