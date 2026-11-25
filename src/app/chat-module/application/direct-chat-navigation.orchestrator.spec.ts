import { convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { DirectChatNavigationOrchestrator } from './direct-chat-navigation.orchestrator';

describe('DirectChatNavigationOrchestrator', () => {
  function setup() {
    const ensureDirectChatIdWithUser$ = vi.fn((_uid: string): Observable<string | null> => of('chat-created'));
    const getPublicUserById$ = vi.fn(() =>
      of({
        uid: 'peer-1',
        nickname: 'Pessoa',
        photoURL: 'https://example.test/photo.jpg',
      } as any)
    );
    const navigate = vi.fn(() => Promise.resolve(true));

    const directChat = {
      ensureDirectChatIdWithUser$,
    } as unknown as DirectChatService;

    const users = {
      getPublicUserById$,
    } as unknown as FirestoreUserQueryService;

    const router = {
      navigate,
    } as unknown as Router;

    return {
      ensureDirectChatIdWithUser$,
      getPublicUserById$,
      navigate,
      orchestrator: new DirectChatNavigationOrchestrator(
        directChat,
        users,
        router
      ),
    };
  }

  it('resolve openChatId sem criar outra conversa', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();

    const values: unknown[] = [];
    orchestrator
      .observeResolvedDeepLinks$(
        of('me'),
        of(convertToParamMap({ openChatId: ' chat-1 ' }))
      )
      .subscribe((value) => values.push(value));

    expect(values).toEqual([{ chatId: 'chat-1', withUser: undefined }]);
    expect(ensureDirectChatIdWithUser$).not.toHaveBeenCalled();
  });

  it('resolve deep-link por usuário pelo serviço canônico de chat direto', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();

    const values: unknown[] = [];
    orchestrator
      .observeResolvedDeepLinks$(
        of('me'),
        of(convertToParamMap({ withUser: 'peer-1' }))
      )
      .subscribe((value) => values.push(value));

    expect(ensureDirectChatIdWithUser$).toHaveBeenCalledWith('peer-1');
    expect(values).toEqual([{ chatId: 'chat-created', withUser: 'peer-1' }]);
  });

  it('isola link inválido e continua observando novas navegações', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();
    const route$ = new BehaviorSubject(convertToParamMap({ withUser: 'me' }));
    const onError = vi.fn();
    const values: unknown[] = [];
    const sub = orchestrator.observeResolvedDeepLinks$(of('me'), route$, onError)
      .subscribe(value => values.push(value));

    expect(values).toEqual([null]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ensureDirectChatIdWithUser$).not.toHaveBeenCalled();
    route$.next(convertToParamMap({ withUser: 'peer-1' }));
    expect(values).toEqual([null, { chatId: 'chat-created', withUser: 'peer-1' }]);
    expect(sub.closed).toBe(false);
    sub.unsubscribe();
  });

  it('recupera falhas síncronas e assíncronas sem encerrar a rota', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();
    ensureDirectChatIdWithUser$
      .mockImplementationOnce(() => { throw new Error('sync'); })
      .mockImplementationOnce(() => throwError(() => new Error('async')));
    const route$ = new BehaviorSubject(convertToParamMap({ withUser: 'peer-1' }));
    const onError = vi.fn();
    const values: unknown[] = [];
    const sub = orchestrator.observeResolvedDeepLinks$(of('me'), route$, onError)
      .subscribe(value => values.push(value));

    route$.next(convertToParamMap({ withUser: 'peer-2' }));
    route$.next(convertToParamMap({ openChatId: 'chat-3' }));
    expect(values).toEqual([null, null, { chatId: 'chat-3', withUser: undefined }]);
    expect(onError).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('cancela intenção pendente na troca de conta e não a reaplica no retorno ao UID', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();
    const pending$ = new Subject<string | null>();
    ensureDirectChatIdWithUser$.mockReturnValueOnce(pending$);
    const uid$ = new BehaviorSubject<string | null>('me');
    const route$ = new BehaviorSubject(convertToParamMap({ withUser: 'peer-1' }));
    const values: unknown[] = [];
    const sub = orchestrator.observeResolvedDeepLinks$(uid$, route$)
      .subscribe(value => values.push(value));

    uid$.next(null);
    uid$.next('other');
    uid$.next('me');
    pending$.next('stale-chat');
    expect(ensureDirectChatIdWithUser$).toHaveBeenCalledTimes(1);
    expect(values.every(value => value === null)).toBe(true);
    route$.next(convertToParamMap({}));
    route$.next(convertToParamMap({ withUser: 'peer-1' }));
    expect(ensureDirectChatIdWithUser$).toHaveBeenCalledTimes(2);
    expect(values.at(-1)).toEqual({ chatId: 'chat-created', withUser: 'peer-1' });
    sub.unsubscribe();
  });

  it('não consome URL vazia e não repete parâmetros iguais; permite nova intenção após limpeza', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();
    const route$ = new BehaviorSubject(convertToParamMap({}));
    const values: unknown[] = [];
    const sub = orchestrator.observeResolvedDeepLinks$(of('me'), route$)
      .subscribe(value => values.push(value));

    expect(values).toEqual([]);
    route$.next(convertToParamMap({ withUser: 'peer-1' }));
    route$.next(convertToParamMap({ withUser: 'peer-1', unrelated: '1' }));
    expect(ensureDirectChatIdWithUser$).toHaveBeenCalledTimes(1);
    route$.next(convertToParamMap({ unrelated: '1' }));
    route$.next(convertToParamMap({ withUser: 'peer-1' }));
    expect(ensureDirectChatIdWithUser$).toHaveBeenCalledTimes(2);
    expect(values).toHaveLength(2);
    sub.unsubscribe();
  });

  it('descarta resolução atrasada após uma nova navegação', () => {
    const { orchestrator, ensureDirectChatIdWithUser$ } = setup();
    const pending$ = new Subject<string | null>();
    ensureDirectChatIdWithUser$.mockReturnValueOnce(pending$);
    const route$ = new BehaviorSubject(convertToParamMap({ withUser: 'peer-1' }));
    const values: unknown[] = [];
    const sub = orchestrator.observeResolvedDeepLinks$(of('me'), route$)
      .subscribe(value => values.push(value));

    route$.next(convertToParamMap({ openChatId: 'chat-2' }));
    pending$.next('stale-chat');
    expect(values).toEqual([{ chatId: 'chat-2', withUser: undefined }]);
    sub.unsubscribe();
  });

  it('resolve somente identidade pública do peer', () => {
    const { orchestrator, getPublicUserById$ } = setup();

    const values: unknown[] = [];
    orchestrator.resolvePeer$('peer-1').subscribe((value) => values.push(value));

    expect(getPublicUserById$).toHaveBeenCalledWith('peer-1');
    expect(values).toEqual([
      {
        uid: 'peer-1',
        name: 'Pessoa',
        photoURL: 'https://example.test/photo.jpg',
      },
    ]);
  });

  it('consome apenas os query params do deep-link', async () => {
    const { orchestrator, navigate } = setup();
    const route = {} as any;

    await expect(orchestrator.consumeDeepLinkQueryParams(route)).resolves.toBe(true);

    expect(navigate).toHaveBeenCalledWith([], {
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
