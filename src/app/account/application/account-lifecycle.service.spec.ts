import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { AccountLifecycleService } from './account-lifecycle.service';

describe('AccountLifecycleService', () => {
  const applicationErrorMock = {
    report: vi.fn(),
  };

  let service: AccountLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        AccountLifecycleService,
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });

    service = TestBed.inject(AccountLifecycleService);
  });

  it('centraliza erro de validação local sem notifier/global manual', async () => {
    const result = firstValueFrom(
      service.moderateSuspendAccount$('', 'motivo válido')
    );

    await expect(result).rejects.toThrow('UID do usuário alvo inválido.');

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'moderation/invalid-target',
        message: 'UID do usuário alvo inválido.',
      }),
      {
        feature: 'account-lifecycle',
        operation: 'invalidInput',
        fallbackMessage: 'UID do usuário alvo inválido.',
        codeMessages: {
          'moderation/invalid-target': 'UID do usuário alvo inválido.',
        },
        metadata: {
          scope: 'AccountLifecycleService',
          phase: 'invalidInput',
          code: 'moderation/invalid-target',
        },
      }
    );
  });

  it('preserva mensagem de reautenticação recente no mapa de reason', () => {
    const resolveReasonMessages = (
      service as unknown as {
        resolveReasonMessages(error: unknown): Readonly<Record<string, string>>;
      }
    ).resolveReasonMessages.bind(service);

    expect(
      resolveReasonMessages({
        details: {
          reason: 'recent-authentication-required',
        },
      })
    ).toEqual({
      'recent-authentication-required':
        'Por segurança, saia e entre novamente antes de repetir esta ação.',
    });
  });

  it('preserva orientação dinâmica para recursos próprios antes da exclusão', () => {
    const resolveReasonMessages = (
      service as unknown as {
        resolveReasonMessages(error: unknown): Readonly<Record<string, string>>;
      }
    ).resolveReasonMessages.bind(service);

    expect(
      resolveReasonMessages({
        details: {
          reason: 'owned-resources-require-resolution',
          activeOwnedRoomCount: 2,
          ownedCommunityCount: 1,
        },
      })
    ).toEqual({
      'owned-resources-require-resolution':
        'Encerre suas Salas ativas e transfira ou arquive suas Comunidades antes de excluir a conta.',
    });
  });
});
