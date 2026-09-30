import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileInteractionOrchestrator } from './visited-profile-interaction.orchestrator';

describe('VisitedProfileInteractionOrchestrator', () => {
  function setup(input?: {
    uid?: string | null;
    chatId?: string | null;
    sendError?: unknown;
    chatError?: unknown;
  }) {
    const sendRequest = vi.fn(() =>
      input?.sendError
        ? throwError(() => input.sendError)
        : of({ ok: true } as any)
    );
    const ensureDirectChatIdWithUser$ = vi.fn(() =>
      input?.chatError
        ? throwError(() => input.chatError)
        : of(input?.chatId ?? 'chat-1')
    );
    const report = vi.fn();

    const orchestrator = new VisitedProfileInteractionOrchestrator(
      { uid$: of(input?.uid ?? 'viewer') } as any,
      { sendRequest } as any,
      { ensureDirectChatIdWithUser$ } as any,
      { report } as any
    );

    return { orchestrator, sendRequest, ensureDirectChatIdWithUser$, report };
  }

  it('envia interesse quando a interação está liberada', async () => {
    const { orchestrator, sendRequest } = setup();

    await expect(
      firstValueFrom(
        orchestrator.sendInterest$('target', true, 'liberado')
      )
    ).resolves.toBe(true);

    expect(sendRequest).toHaveBeenCalledWith(
      'viewer',
      'target',
      'Olá! Gostaria de conhecer você.'
    );
  });

  it('bloqueia interesse indisponível sem chamar o backend', async () => {
    const { orchestrator, sendRequest, report } = setup();

    await expect(
      firstValueFrom(
        orchestrator.sendInterest$('target', false, 'Interesse já enviado.')
      )
    ).resolves.toBe(false);

    expect(sendRequest).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('prepara chat direto e preserva fallback nulo em falha', async () => {
    const error = new Error('chat failed');
    const { orchestrator, report } = setup({ chatError: error });

    await expect(
      firstValueFrom(orchestrator.prepareDirectChat$('target'))
    ).resolves.toBeNull();

    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-view',
      operation: 'VisitedProfileInteractionOrchestrator.prepareDirectChat',
      fallbackMessage: 'Não foi possível preparar a conversa.',
      metadata: {
        scope: 'VisitedProfileInteractionOrchestrator',
        hasTargetUid: true,
      },
    });
  });
});
