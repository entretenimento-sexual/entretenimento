import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import type { User } from 'firebase/auth';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.currentUser = null;

    TestBed.configureTestingModule({
      providers: [
        AccountReauthenticationService,
        { provide: Auth, useValue: authMock },
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
});
