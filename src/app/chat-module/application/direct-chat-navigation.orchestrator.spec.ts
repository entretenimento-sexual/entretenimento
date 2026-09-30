import { convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { DirectChatNavigationOrchestrator } from './direct-chat-navigation.orchestrator';

describe('DirectChatNavigationOrchestrator', () => {
  function setup() {
    const directChat = {
      ensureDirectChatIdWithUser$: vi.fn(() => of('chat-created')),
    } as unknown as DirectChatService;

    const users = {
      getPublicUserById$: vi.fn(() =>
        of({
          uid: 'peer-1',
          nickname: 'Pessoa',
          photoURL: 'https://example.test/photo.jpg',
        } as any)
      ),
    } as unknown as FirestoreUserQueryService;

    const router = {
      navigate: vi.fn(() => Promise.resolve(true)),
    } as unknown as Router;

    return {
      directChat,
      users,
      router,
      orchestrator: new DirectChatNavigationOrchestrator(
        directChat,
        users,
        router
      ),
    };
  }

  it('resolve openChatId sem criar outra conversa', () => {
    const { orchestrator, directChat } = setup();

    const values: unknown[] = [];
    orchestrator
      .observeResolvedDeepLinks$(
        of('me'),
        of(convertToParamMap({ openChatId: ' chat-1 ' }))
      )
      .subscribe((value) => values.push(value));

    expect(values).toEqual([{ chatId: 'chat-1', withUser: undefined }]);
    expect(
      (directChat.ensureDirectChatIdWithUser$ as unknown as ReturnType<typeof vi.fn>)
    ).not.toHaveBeenCalled();
  });

  it('resolve deep-link por usuário pelo serviço canônico de chat direto', () => {
    const { orchestrator, directChat } = setup();

    const values: unknown[] = [];
    orchestrator
      .observeResolvedDeepLinks$(
        of('me'),
        of(convertToParamMap({ withUser: 'peer-1' }))
      )
      .subscribe((value) => values.push(value));

    expect(
      (directChat.ensureDirectChatIdWithUser$ as unknown as ReturnType<typeof vi.fn>)
    ).toHaveBeenCalledWith('peer-1');
    expect(values).toEqual([{ chatId: 'chat-created', withUser: 'peer-1' }]);
  });

  it('resolve somente identidade pública do peer', () => {
    const { orchestrator, users } = setup();

    const values: unknown[] = [];
    orchestrator.resolvePeer$('peer-1').subscribe((value) => values.push(value));

    expect(
      (users.getPublicUserById$ as unknown as ReturnType<typeof vi.fn>)
    ).toHaveBeenCalledWith('peer-1');
    expect(values).toEqual([
      {
        uid: 'peer-1',
        name: 'Pessoa',
        photoURL: 'https://example.test/photo.jpg',
      },
    ]);
  });

  it('consome apenas os query params do deep-link', async () => {
    const { orchestrator, router } = setup();
    const route = {} as any;

    await expect(orchestrator.consumeDeepLinkQueryParams(route)).resolves.toBe(true);

    expect(
      (router.navigate as unknown as ReturnType<typeof vi.fn>)
    ).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: {
        openChatId: null,
        withUser: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
});
