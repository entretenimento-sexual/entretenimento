// src/app/core/services/autentication/login.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginService } from './login.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { ApplicationErrorService } from '../error-handler/application-error.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

describe('LoginService', () => {
  let service: LoginService;
  let authMock: { currentUser: any };
  let deferPromise$: ReturnType<typeof vi.fn>;
  const report = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    authMock = { currentUser: null };
    deferPromise$ = vi.fn(
      <T>(task: () => Promise<T>): Observable<T> => of(task() as T)
    );

    TestBed.configureTestingModule({
      providers: [
        LoginService,
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser$: vi.fn(() => of(null)),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
        {
          provide: Auth,
          useValue: authMock,
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$,
          },
        },
      ],
    });

    service = TestBed.inject(LoginService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('falha fechado ao reautenticar sem usuário com provedor de senha', async () => {
    const message =
      'Não foi possível confirmar uma conta com senha nesta sessão.';

    await expect(
      firstValueFrom(service.reauthenticateUser$('senha-segura'))
    ).rejects.toThrow(message);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        code: 'auth/password-provider-unavailable',
        skipUserNotification: true,
      }),
      {
        feature: 'login',
        operation: 'reauthenticateUser$',
        fallbackMessage: message,
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LoginService',
          operation: 'reauthenticateUser$',
          code: 'auth/password-provider-unavailable',
        },
      }
    );
  });

  it('rejeita recuperação com e-mail inválido antes da rede', async () => {
    const message = 'Informe um e-mail válido.';

    await expect(
      firstValueFrom(service.sendPasswordReset$('email-invalido'))
    ).rejects.toThrow(message);

    expect(deferPromise$).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        code: 'validation/invalid-email',
        skipUserNotification: true,
      }),
      {
        feature: 'login',
        operation: 'sendPasswordReset$',
        fallbackMessage: message,
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LoginService',
          operation: 'sendPasswordReset$',
          code: 'validation/invalid-email',
        },
      }
    );
  });

  it('rejeita confirmação com senha abaixo do mínimo', async () => {
    const message = 'A nova senha deve ter pelo menos 8 caracteres.';

    await expect(
      firstValueFrom(service.confirmPasswordReset$('codigo', '1234567'))
    ).rejects.toThrow(message);

    expect(deferPromise$).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        code: 'validation/weak-password',
        skipUserNotification: true,
      }),
      {
        feature: 'login',
        operation: 'confirmPasswordReset$',
        fallbackMessage: message,
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LoginService',
          operation: 'confirmPasswordReset$',
          code: 'validation/weak-password',
        },
      }
    );
  });

  it('reporta silenciosamente e repropaga o erro original da recuperação', async () => {
    const original = Object.assign(new Error('network down'), {
      code: 'auth/network-request-failed',
    });

    deferPromise$.mockImplementationOnce(
      () => throwError(() => original)
    );

    await expect(
      firstValueFrom(service.sendPasswordReset$('pessoa@example.com'))
    ).rejects.toBe(original);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'login',
      operation: 'sendPasswordReset$',
      fallbackMessage: 'Falha em sendPasswordReset$.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'LoginService',
        operation: 'sendPasswordReset$',
        email: 'pe***@example.com',
      },
    });
  });

  it('não altera o resultado principal se a própria camada de diagnóstico falhar', async () => {
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(
      firstValueFrom(service.sendPasswordReset$('email-invalido'))
    ).rejects.toThrow('Informe um e-mail válido.');

    expect(report).toHaveBeenCalledTimes(1);
  });
});
