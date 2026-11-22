// src/app/register-module/auth-verification-handler/auth-verification-handler.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { PasswordResetCodeValidationService } from '../../core/services/autentication/password-reset-code-validation.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { LogoutService } from '@core/services/autentication/auth/logout.service';
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
  };

  let passwordResetValidationMock: {
    validate$: Mock;
  };

  let session: { currentAuthUser: { uid: string } | null };
  let logout: { logout$: Mock };
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

    session = { currentAuthUser: null };
    logout = { logout$: vi.fn(() => of(void 0)) };

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
        cooldownUntilMs: 0,
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
        provideZonelessChangeDetection(),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParamsSubject.asObservable(),
          },
        },
        { provide: Router, useValue: routerMock },
        { provide: EmailVerificationService, useValue: emailVerificationMock },
        { provide: AuthSessionService, useValue: session },
        { provide: LogoutService, useValue: logout },
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
        verifiedUid: 'user-a',
        firestoreUpdated: true,
      })
    );

    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'abc123' });
    fixture.detectChanges();

    expect(emailVerificationMock.handleEmailVerification).not.toHaveBeenCalled();
    const confirm = fixture.nativeElement.querySelector('button');
    expect(confirm.textContent.trim()).toBe('Confirmar e-mail');
    confirm.click();
    expect(emailVerificationMock.handleEmailVerification).toHaveBeenCalledTimes(1);
    expect(component.verifyOk).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(component.message).toBe('E-mail verificado com sucesso.');
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('anuncia a confirmação assíncrona de e-mail e oferece o login', async () => {
    const verification = new Subject<{ ok: true; reason: 'not-logged-in' }>();
    emailVerificationMock.handleEmailVerification.mockReturnValue(verification);
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'verify-code' });
    await fixture.whenStable();

    const page: HTMLElement = fixture.nativeElement;
    page.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(page.querySelector('[aria-busy="true"]')).not.toBeNull();

    verification.next({ ok: true, reason: 'not-logged-in' });
    await fixture.whenStable();

    expect(page.querySelector('[aria-busy="true"]')).toBeNull();
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Seu e-mail foi verificado.');
    expect(page.querySelector('button')?.textContent?.trim()).toBe('Ir para o login');
  });

  it('orienta entrar na conta do link antes de solicitar outro quando expirado', () => {
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({ ok: false, reason: 'expired' })
    );

    queryParamsSubject.next({
      mode: 'verifyEmail',
      oobCode: 'expired-code',
    });
    fixture.detectChanges();

    component.confirmEmailVerification();
    fixture.detectChanges();
    expect(component.verifyOk).toBe(false);
    expect(component.showGoToLoginCTA).toBe(true);
    expect(component.message).toContain('Entre na conta que recebeu o link');
  });

  it('oferece trocar de conta sem iniciar logout automaticamente', () => {
    session.currentAuthUser = { uid: 'B' };
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({ ok: true, reason: 'different-account', firestoreUpdated: false })
    );
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'test-code' });
    fixture.detectChanges();

    component.confirmEmailVerification();
    fixture.detectChanges();
    expect(component.verifyOk).toBe(true);
    expect(component.canSwitchAccount).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('Continuar cadastro');
    expect(logout.logout$).not.toHaveBeenCalled();
    component.switchVerificationAccount();
    expect(logout.logout$).toHaveBeenCalledOnce();
  });

  it('informa atualização pendente e conserva o resultado quando a conta troca antes de continuar', () => {
    session.currentAuthUser = { uid: 'A' };
    emailVerificationMock.handleEmailVerification.mockReturnValue(
      of({ ok: true, reason: 'sync-pending', firestoreUpdated: false, verifiedUid: 'A' })
    );
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'test-code' });
    fixture.detectChanges();
    component.confirmEmailVerification();
    fixture.detectChanges();
    expect(component.message).toContain('ainda está pendente');
    session.currentAuthUser = { uid: 'B' };
    component.goToWelcome();
    expect(routerMock.navigate).not.toHaveBeenCalled();
    expect(component.canSwitchAccount).toBe(true);
  });

  it('mantém o resultado do link atual quando chega uma resposta anterior', () => {
    const oldResult = new Subject();
    emailVerificationMock.handleEmailVerification
      .mockReturnValueOnce(oldResult)
      .mockReturnValueOnce(of({ ok: false, reason: 'expired' }));
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'older' });
    fixture.detectChanges();
    component.confirmEmailVerification();
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'newer' });
    component.confirmEmailVerification();
    oldResult.next({ ok: true, firestoreUpdated: true });

    expect(component.verifyOk).toBe(false);
    expect(component.message).toContain('expirou');
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

  it('exibe o formulário após validação assíncrona e confirma a redefinição na tela', async () => {
    const validation = new Subject<{ ok: true; reason: 'valid'; message: string }>();
    const reset = new Subject<void>();
    passwordResetValidationMock.validate$.mockReturnValue(validation);
    loginServiceMock.confirmPasswordReset$.mockReturnValue(reset);
    queryParamsSubject.next({
      mode: 'resetPassword',
      oobCode: 'reset-code',
    });
    await fixture.whenStable();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('form')).toBeNull();
    expect(page.querySelector('[aria-busy="true"]')).not.toBeNull();

    validation.next({ ok: true, reason: 'valid', message: 'Link válido.' });
    await fixture.whenStable();
    expect(page.querySelector('#newPassword')).not.toBeNull();
    expect(page.querySelector('[aria-busy="true"]')).toBeNull();

    routerMock.navigate.mockResolvedValueOnce(false);
    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'SenhaSegura123';

    const submission = component.resetPassword();
    reset.next();
    await submission;
    await fixture.whenStable();

    expect(loginServiceMock.confirmPasswordReset$).toHaveBeenCalledWith(
      'reset-code',
      'SenhaSegura123'
    );
    expect(component.passwordResetOk).toBe(true);
    expect(component.passwordResetCompleted).toBe(true);
    expect(component.actionSucceeded).toBe(true);
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Senha redefinida com sucesso.');
    expect(page.querySelector('form')).toBeNull();
    expect(component.newPassword).toBe('');
    expect(component.confirmPassword).toBe('');
    expect(routerMock.navigate).not.toHaveBeenCalled();

    page.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Tente novamente.');
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Senha redefinida com sucesso.');

    page.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(routerMock.navigate).toHaveBeenCalledTimes(2);
    expect(routerMock.navigate).toHaveBeenLastCalledWith(
      ['/login'], expect.objectContaining({ replaceUrl: true })
    );
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignora o retorno da redefinição quando outro link é aberto', async () => {
    const reset = new Subject<void>();
    loginServiceMock.confirmPasswordReset$.mockReturnValue(reset);
    queryParamsSubject.next({ mode: 'resetPassword', oobCode: 'reset-code' });
    await fixture.whenStable();

    component.newPassword = 'SenhaSegura123';
    component.confirmPassword = 'SenhaSegura123';
    const submission = component.resetPassword();
    queryParamsSubject.next({ mode: 'verifyEmail', oobCode: 'next-code' });
    reset.next();
    await submission;
    await fixture.whenStable();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('h1')?.textContent).toBe('Confirme seu e-mail');
    expect(page.querySelector('[role="status"]')).toBeNull();
    expect(routerMock.navigate).not.toHaveBeenCalled();
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
