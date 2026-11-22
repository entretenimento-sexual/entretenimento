import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import type { User } from 'firebase/auth';
import { BehaviorSubject, Subject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import {
  AccountReauthenticationService,
  resolveAccountReauthenticationMode,
} from './account-reauthentication.service';

describe('resolveAccountReauthenticationMode', () => {
  it('prioriza senha quando a conta possui senha e Google vinculados', () => {
    expect(
      resolveAccountReauthenticationMode(['google.com', 'password'])
    ).toBe('password');
  });

  it('usa Google quando esse é o único provedor compatível', () => {
    expect(resolveAccountReauthenticationMode(['google.com'])).toBe(
      'google'
    );
  });

  it('falha fechado para provedor ainda não suportado', () => {
    expect(resolveAccountReauthenticationMode(['apple.com'])).toBe(
      'unsupported'
    );
    expect(resolveAccountReauthenticationMode([])).toBe('unsupported');
  });
});

describe('AccountReauthenticationService', () => {
  const applicationErrorMock = {
    report: vi.fn(),
  };

  const authMock: { currentUser: User | null } = {
    currentUser: null,
  };

  let service: AccountReauthenticationService;
  const user$ = new BehaviorSubject<User | null>(null);
  const session = {
    authUser$: user$.asObservable(),
    isTerminatingSnapshot: false,
    terminationVersionSnapshot: 0,
  };

  function switchAccount(user: User | null): void {
    authMock.currentUser = user;
    user$.next(user);
  }


  beforeEach(() => {
    vi.clearAllMocks();
    switchAccount(null);
    session.isTerminatingSnapshot = false;
    session.terminationVersionSnapshot = 0;

    TestBed.configureTestingModule({
      providers: [
        AccountReauthenticationService,
        { provide: Auth, useValue: authMock },
        { provide: AuthSessionService, useValue: session },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });

    service = TestBed.inject(AccountReauthenticationService);
  });

  it('preserva falha fechada sem notificação nova quando a sessão já terminou', async () => {
    await expect(
      firstValueFrom(service.reauthenticateForSensitiveAction$())
    ).rejects.toMatchObject({
      code: 'auth/unauthenticated',
      message: 'Sua sessão terminou. Entre novamente para continuar.',
    });

    expect(applicationErrorMock.report).not.toHaveBeenCalled();
  });

  it('centraliza senha ausente com o mapa canônico de reautenticação', async () => {
    authMock.currentUser = {
      email: 'user@example.com',
      providerData: [{ providerId: 'password' }],
    } as User;

    await expect(
      firstValueFrom(service.reauthenticateForSensitiveAction$(''))
    ).rejects.toMatchObject({
      code: 'validation/password-required',
    });

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'validation/password-required',
      }),
      expect.objectContaining({
        feature: 'account-reauthentication',
        operation: 'reauthenticateForSensitiveAction$',
        fallbackMessage: 'Não foi possível confirmar sua identidade agora.',
        codeMessages: expect.objectContaining({
          'auth/wrong-password': 'A senha informada não confere.',
          'auth/invalid-credential': 'A senha informada não confere.',
          'auth/invalid-login-credentials': 'A senha informada não confere.',
          'validation/password-required':
            'Informe sua senha atual para confirmar esta ação.',
          'auth/user-mismatch':
            'Confirme com a mesma conta Google vinculada ao seu perfil.',
          'auth/popup-closed-by-user':
            'A confirmação com Google foi cancelada.',
          'auth/cancelled-popup-request':
            'A confirmação com Google foi cancelada.',
          'auth/popup-blocked':
            'O navegador bloqueou a confirmação com Google. Libere pop-ups e tente novamente.',
          'auth/too-many-requests':
            'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
          'auth/network-request-failed':
            'Falha de conexão durante a confirmação. Verifique sua internet e tente novamente.',
          'auth/unauthenticated':
            'Sua sessão terminou. Entre novamente para continuar.',
          'auth/reauthentication-provider-unsupported':
            'O provedor desta conta ainda não possui confirmação segura nesta versão.',
        }),
        metadata: {
          scope: 'AccountReauthenticationService',
          mode: 'password',
        },
      })
    );
  });

  it('preserva a mensagem de provedor não suportado', async () => {
    authMock.currentUser = {
      email: 'user@example.com',
      providerData: [{ providerId: 'apple.com' }],
    } as User;

    await expect(
      firstValueFrom(service.reauthenticateForSensitiveAction$())
    ).rejects.toMatchObject({
      code: 'auth/reauthentication-provider-unsupported',
    });

    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth/reauthentication-provider-unsupported',
      }),
      expect.objectContaining({
        feature: 'account-reauthentication',
        metadata: {
          scope: 'AccountReauthenticationService',
          mode: 'unsupported',
        },
      })
    );
  });
  it('não confirma uma ação aberta antes da troca de conta', async () => {
    switchAccount({ uid: 'uid-a' } as User);
    const scope = service.captureSensitiveActionSession();
    switchAccount({ uid: 'uid-b' } as User);
    const reauthenticate = vi.spyOn(service, 'reauthenticateForSensitiveAction$');
    const action = vi.fn(() => of(true));

    await expect(firstValueFrom(service.runSensitiveAction$(scope, null, action)))
      .rejects.toMatchObject({ code: 'auth/session-changed' });
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
  });

  it('ignora confirmação tardia após troca de conta', async () => {
    switchAccount({ uid: 'uid-a' } as User);
    const confirmation = new Subject<void>();
    vi.spyOn(service, 'reauthenticateForSensitiveAction$').mockReturnValue(confirmation);
    const action = vi.fn(() => of(true));
    const result = firstValueFrom(service.runSensitiveAction$(
      service.captureSensitiveActionSession(), null, action
    ));
    const rejected = expect(result).rejects.toMatchObject({ code: 'auth/session-changed' });

    switchAccount({ uid: 'uid-b' } as User);
    confirmation.next();
    await rejected;
    expect(action).not.toHaveBeenCalled();
  });

  it('envia o UID confirmado e descarta resultado quando a geração da sessão muda', async () => {
    const user = { uid: 'uid-a' } as User;
    switchAccount(user);
    vi.spyOn(service, 'reauthenticateForSensitiveAction$').mockReturnValue(of(void 0));
    const response = new Subject<boolean>();
    const action = vi.fn(() => response);
    const result = firstValueFrom(service.runSensitiveAction$(
      service.captureSensitiveActionSession(), null, action
    ));
    const rejected = expect(result).rejects.toMatchObject({ code: 'auth/session-changed' });

    expect(action).toHaveBeenCalledWith('uid-a');
    session.terminationVersionSnapshot++;
    response.next(true);
    await rejected;
  });

});
