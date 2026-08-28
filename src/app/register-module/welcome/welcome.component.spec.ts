// src/app/register-module/welcome/welcome.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { WelcomeComponent } from './welcome.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { EmulatorEmailVerifyDevService } from '../../core/services/autentication/register/emulator-email-verify-dev.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';

class EmailVerificationServiceMock {
  resendVerificationEmail = vi.fn(() => of('OK'));
}

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WelcomeComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        {
          provide: RegisterFlowFacade,
          useValue: {
            vm$: of({
              uid: 'u1',
              email: 'user@example.com',
              emailVerified: false,
              profileCompleted: false,
              userResolved: true,
              authReady: true,
              currentStep: 'profileCompletion',
              blockingMessage: null,
            }),
            reloadAndSyncEmailVerification$: vi.fn(() => of(false)),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            authUser$: of({ uid: 'u1', email: 'user@example.com' }),
            ready$: of(true),
            refreshCurrentUser$: vi.fn(() =>
              of({
                uid: 'u1',
                email: 'user@example.com',
                emailVerified: false,
              })
            ),
          },
        },
        { provide: EmailVerificationService, useClass: EmailVerificationServiceMock },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
          },
        },
        {
          provide: EmulatorEmailVerifyDevService,
          useValue: {
            markVerifiedInEmulatorDebug$: vi.fn(() => of({ after: { emailVerified: true } })),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('não afirma que o e-mail foi enviado quando o envio inicial falhou', () => {
    component.verificationEmailDelivery = 'failed';
    fixture.detectChanges();

    const subtitle = fixture.nativeElement.querySelector(
      '#welcome-subtitle'
    ) as HTMLElement;
    const copy = subtitle.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(copy).toContain('primeiro envio do link');
    expect(copy).toContain('não foi confirmado');
    expect(copy).not.toContain('Enviamos um link de verificação');
  });

  it('mantém mensagem neutra quando o estado do envio é desconhecido', () => {
    component.verificationEmailDelivery = 'unknown';
    fixture.detectChanges();

    const subtitle = fixture.nativeElement.querySelector(
      '#welcome-subtitle'
    ) as HTMLElement;
    const copy = subtitle.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(copy).toContain('Se o link ainda não chegou');
    expect(copy).not.toContain('Enviamos um link de verificação');
  });

  it('preserva erro operacional sem convertê-lo em verificação pendente', () => {
    const authSession = TestBed.inject(AuthSessionService) as unknown as {
      refreshCurrentUser$: ReturnType<typeof vi.fn>;
    };

    authSession.refreshCurrentUser$.mockReturnValueOnce(
      throwError(() => new Error('network-down'))
    );

    component.checkNow();

    expect(component.banner?.variant).toBe('error');
    expect(component.banner?.title).toBe('Erro ao verificar e-mail');
    expect(component.banner?.title).not.toBe(
      'Ainda não encontramos a verificação'
    );
    expect(component.checkingVerification).toBe(false);
  });

  it('usa apenas o banner contextual quando o reenvio falha', () => {
    const emailVerification = TestBed.inject(
      EmailVerificationService
    ) as unknown as EmailVerificationServiceMock;
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as { showError: ReturnType<typeof vi.fn> };

    emailVerification.resendVerificationEmail.mockReturnValueOnce(
      throwError(() => ({ code: 'auth/network-request-failed' }))
    );

    component.resendVerificationEmail();

    expect(component.banner?.variant).toBe('error');
    expect(component.banner?.title).toBe('Erro ao reenviar o e-mail');
    expect(notifier.showError).not.toHaveBeenCalled();
  });

  it('mantém ações do usuário no card e não duplica CTAs no banner', () => {
    component.banner = {
      variant: 'info',
      title: 'Confirme seu e-mail',
      message: 'Use as ações abaixo.',
    };
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.welcome-alert .alert-actions__main')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.status-card .primary-actions')
    ).not.toBeNull();
  });

  it('exibe um único CTA de continuidade quando o e-mail já está verificado', () => {
    component.emailVerified = true;
    component.profileCompleted = false;
    component.sessionInvalid = false;
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.status-card .primary-actions button'
      ) as NodeListOf<HTMLButtonElement>
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Completar perfil');
    expect(fixture.nativeElement.querySelector('.steps')).toBeNull();
    expect(fixture.nativeElement.querySelector('.success-card')).toBeNull();
  });

  it('não mantém ações de verificação quando a sessão está encerrada', () => {
    component.sessionInvalid = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.card-error')).not.toBeNull();
  });

  it('usa introdução simples sem selo redundante antes do título', () => {
    expect(fixture.nativeElement.querySelector('#welcome-title')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.welcome-badge')).toBeNull();
  });

  it('orienta o usuário quando o provedor de e-mail não possui atalho conhecido', () => {
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as { showInfo: ReturnType<typeof vi.fn> };

    component.email = 'user@empresa.com.br';
    component.openInbox();

    expect(notifier.showInfo).toHaveBeenCalledWith(
      'Abra seu aplicativo ou provedor de e-mail para conferir user@empresa.com.br.'
    );
  });

  it('confirma quando o e-mail é copiado para a área de transferência', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as { showSuccess: ReturnType<typeof vi.fn> };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    component.email = 'user@example.com';
    component.copyEmail();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('user@example.com');
    expect(notifier.showSuccess).toHaveBeenCalledWith('E-mail copiado.');
  });

  it('informa falha de cópia e mantém o erro técnico no handler global', async () => {
    const clipboardError = new Error('clipboard-denied');
    const writeText = vi.fn(() => Promise.reject(clipboardError));
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as { showWarning: ReturnType<typeof vi.fn> };
    const globalHandler = TestBed.inject(
      GlobalErrorHandlerService
    ) as unknown as { handleError: ReturnType<typeof vi.fn> };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    component.email = 'user@example.com';
    component.copyEmail();
    await Promise.resolve();
    await Promise.resolve();

    expect(globalHandler.handleError).toHaveBeenCalledTimes(1);
    expect(notifier.showWarning).toHaveBeenCalledWith(
      'Não foi possível copiar o e-mail. Tente novamente ou copie manualmente.'
    );
  });
});
