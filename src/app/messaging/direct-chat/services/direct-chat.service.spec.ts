import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
}));

vi.mock('@angular/fire/functions', () => ({
  Functions: class Functions {},
  httpsCallable: firebaseMocks.httpsCallable,
}));

import type { Functions } from '@angular/fire/functions';

import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

import { DirectChatService } from './direct-chat.service';

function buildChat(id: string, isRoom = false): IChat {
  return {
    id,
    isRoom,
  } as IChat;
}

function createHarness(options?: {
  uid$?: Observable<string | null>;
  canListen$?: Observable<boolean>;
  watchChats$?: ReturnType<typeof vi.fn>;
  refreshParticipantDetailsIfNeeded?: ReturnType<typeof vi.fn>;
}) {
  const callable = vi.fn();
  firebaseMocks.httpsCallable.mockReturnValue(callable);

  const chatService = {
    watchChats$:
      options?.watchChats$ ??
      vi.fn(() => of([buildChat('chat-1')])),
    refreshParticipantDetailsIfNeeded:
      options?.refreshParticipantDetailsIfNeeded ?? vi.fn(),
  };

  const authSession = {
    uid$: options?.uid$ ?? of('user-a'),
  };

  const accessControl = {
    canListenRealtime$: options?.canListen$ ?? of(true),
  };

  const applicationError = {
    report: vi.fn(),
  };

  const errorNotifier = {
    showError: vi.fn(),
  };

  const service = new DirectChatService(
    chatService as unknown as ChatService,
    {} as Functions,
    authSession as unknown as AuthSessionService,
    accessControl as unknown as AccessControlService,
    applicationError as unknown as ApplicationErrorService,
    errorNotifier as unknown as ErrorNotificationService
  );

  return {
    service,
    callable,
    chatService,
    applicationError,
    errorNotifier,
  };
}

beforeEach(() => {
  firebaseMocks.httpsCallable.mockReset();
});

describe('DirectChatService canonical errors', () => {
  it('mantém somente chats diretos sem alterar o contrato da lista', async () => {
    const watchChats$ = vi.fn(() =>
      of([
        buildChat('direct-1'),
        buildChat('room-1', true),
        buildChat('direct-2'),
      ])
    );
    const { service, applicationError } = createHarness({ watchChats$ });

    await expect(
      firstValueFrom(service.getMyDirectChats$())
    ).resolves.toEqual([
      buildChat('direct-1'),
      buildChat('direct-2'),
    ]);

    expect(watchChats$).toHaveBeenCalledWith('user-a', 50);
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('não rediagnostica erro já pertencente a ChatService.watchChats$', async () => {
    const error = new Error('watch failed');
    const watchChats$ = vi.fn(() => throwError(() => error));
    const { service, applicationError } = createHarness({ watchChats$ });

    await expect(
      firstValueFrom(service.getMyDirectChats$())
    ).resolves.toEqual([]);

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('diagnostica silenciosamente erro originado no gate da própria lista', async () => {
    const error = new Error('access stream failed');
    const { service, applicationError } = createHarness({
      canListen$: throwError(() => error),
    });

    await expect(
      firstValueFrom(service.getMyDirectChats$())
    ).resolves.toEqual([]);

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation: 'DirectChatService.getMyDirectChats$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat direto.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectChatService',
        context: 'DirectChatService.getMyDirectChats$',
      },
    });
  });

  it('mantém validação local de sessão como UX sem diagnóstico técnico', async () => {
    const { service, callable, applicationError, errorNotifier } =
      createHarness({ uid$: of(null) });

    await expect(
      firstValueFrom(service.ensureDirectChatIdWithUser$('peer-b'))
    ).resolves.toBeNull();

    expect(callable).not.toHaveBeenCalled();
    expect(applicationError.report).not.toHaveBeenCalled();
    expect(errorNotifier.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifier.showError).toHaveBeenCalledWith(
      'Você precisa estar autenticado para abrir este chat.'
    );
  });

  it('mantém validação de chat consigo mesmo fora da telemetria de erro', async () => {
    const { service, callable, applicationError, errorNotifier } =
      createHarness({ uid$: of('user-a') });

    await expect(
      firstValueFrom(service.ensureDirectChatIdWithUser$('user-a'))
    ).resolves.toBeNull();

    expect(callable).not.toHaveBeenCalled();
    expect(applicationError.report).not.toHaveBeenCalled();
    expect(errorNotifier.showError).toHaveBeenCalledWith(
      'Não é possível abrir um chat com o próprio perfil.'
    );
  });

  it('centraliza falha do callable em um único diagnóstico e snackbar', async () => {
    const error = Object.assign(
      new Error('Conexão precisa estar aceita antes de iniciar conversa.'),
      { code: 'functions/failed-precondition' }
    );
    const { service, callable, applicationError, errorNotifier } =
      createHarness();

    callable.mockRejectedValue(error);

    await expect(
      firstValueFrom(service.ensureDirectChatIdWithUser$('peer-b'))
    ).resolves.toBeNull();

    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith({
      otherUserUid: 'peer-b',
    });
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation: 'DirectChatService.ensureDirectChatIdWithUser$',
      fallbackMessage:
        'Vocês precisam estar conectados para iniciar uma conversa.',
      codeMessages: {
        unauthenticated:
          'Vocês precisam estar conectados para iniciar uma conversa.',
        'failed-precondition':
          'Vocês precisam estar conectados para iniciar uma conversa.',
        'permission-denied':
          'Vocês precisam estar conectados para iniciar uma conversa.',
      },
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'DirectChatService',
        context: 'DirectChatService.ensureDirectChatIdWithUser$',
      },
    });
    expect(errorNotifier.showError).not.toHaveBeenCalled();
  });

  it('preserva feedback se a camada canônica falhar antes da apresentação', async () => {
    const error = Object.assign(new Error('denied'), {
      code: 'functions/permission-denied',
    });
    const { service, callable, applicationError, errorNotifier } =
      createHarness();

    callable.mockRejectedValue(error);
    applicationError.report.mockImplementation(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(
      firstValueFrom(service.ensureDirectChatIdWithUser$('peer-b'))
    ).resolves.toBeNull();

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(errorNotifier.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifier.showError).toHaveBeenCalledWith(
      'Esta conversa não está disponível.'
    );
  });

  it('diagnostica silenciosamente falha síncrona do refresh legado', () => {
    const error = new Error('refresh failed');
    const refreshParticipantDetailsIfNeeded = vi.fn(() => {
      throw error;
    });
    const { service, applicationError } = createHarness({
      refreshParticipantDetailsIfNeeded,
    });

    expect(() =>
      service.refreshParticipantDetailsIfNeeded('chat-1')
    ).not.toThrow();

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation:
        'DirectChatService.refreshParticipantDetailsIfNeeded',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat direto.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectChatService',
        context:
          'DirectChatService.refreshParticipantDetailsIfNeeded',
      },
    });
  });
});
