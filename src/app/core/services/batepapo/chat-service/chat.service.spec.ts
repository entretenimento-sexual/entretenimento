import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { ChatService } from './chat.service';

function createHarness() {
  const authSession = {
    ready$: of(true),
    authUser$: of({ uid: 'user-1', emailVerified: true }),
    uid$: of('user-1'),
  };

  const appBlock = {
    reason$: of(null),
  };

  const cache = {
    get: vi.fn(() => of(null)),
    set: vi.fn(),
  };

  const userRepo = {
    getUser$: vi.fn(() => of(null)),
  };

  const policy = {
    canSendMessage$: vi.fn(() => of({ canSend: true })),
  };

  const chatsRepo = {};
  const msgsRepo = {};

  const applicationError = {
    report: vi.fn(),
  };

  const service = new ChatService(
    authSession as any,
    appBlock as any,
    cache as any,
    userRepo as any,
    policy as any,
    chatsRepo as any,
    msgsRepo as any,
    applicationError as unknown as ApplicationErrorService
  );

  return {
    service,
    applicationError,
  };
}

describe('ChatService canonical errors', () => {
  it('reporta erro técnico uma única vez e o mantém silencioso', async () => {
    const { service, applicationError } = createHarness();
    const error = new Error('repository failed');

    const silent$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('getMessages', error);

    await expect(firstValueFrom(silent$)).rejects.toBe(error);

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'chat',
      operation: 'getMessages',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatService',
        action: 'getMessages',
      },
    });
    expect((error as any).chatApplicationErrorReported).toBe(true);

    const outer$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('sendMessage', error);

    await expect(firstValueFrom(outer$)).rejects.toBe(error);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('centraliza validação de UX, marca uiShown e evita novo diagnóstico externo', async () => {
    const { service, applicationError } = createHarness();
    const error = new Error('Mensagem vazia');

    const ui$ = (
      service as unknown as {
        failUi(
          action: string,
          userMessage: string,
          error: unknown
        ): ReturnType<ChatService['getMessages']>;
      }
    ).failUi(
      'sendMessage',
      'A mensagem não pode ser vazia.',
      error
    );

    await expect(firstValueFrom(ui$)).rejects.toBe(error);

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'chat',
      operation: 'sendMessage',
      fallbackMessage: 'A mensagem não pode ser vazia.',
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'ChatService',
        action: 'sendMessage',
        uiShown: true,
      },
    });
    expect((error as any).uiShown).toBe(true);
    expect((error as any).chatApplicationErrorReported).toBe(true);

    const outer$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('sendMessage.outer', error);

    await expect(firstValueFrom(outer$)).rejects.toBe(error);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('preserva valor original quando precisa criar um Error para falha não-Error', async () => {
    const { service, applicationError } = createHarness();
    const source = { code: 'firestore/unavailable' };

    const silent$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('watchChats$', source);

    let thrown: unknown;
    try {
      await firstValueFrom(silent$);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as any).original).toBe(source);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });
});
