import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatNavigationOrchestrator } from './direct-chat-navigation.orchestrator';
import { DirectChatSelectionContextFacade } from './direct-chat-selection-context.facade';

describe('DirectChatSelectionContextFacade', () => {
  function setup(input?: {
    selectedChat$?: Observable<{ id: string; participants: string[] } | null>;
    resolvePeer$?: (uid: string) => Observable<{
      uid: string;
      name: string | null;
      photoURL: string | null;
    } | null>;
  }) {
    const selectChat = vi.fn();
    const clearSelection = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        DirectChatSelectionContextFacade,
        {
          provide: DirectChatFacade,
          useValue: {
            selectedChat$: input?.selectedChat$ ?? of({
              id: 'chat-1',
              participants: ['me', 'peer-1'],
            }),
            selectChat,
            clearSelection,
          },
        },
        {
          provide: DirectChatNavigationOrchestrator,
          useValue: {
            resolvePeer$: input?.resolvePeer$ ?? vi.fn(() =>
              of({
                uid: 'peer-1',
                name: 'Pessoa',
                photoURL: 'https://example.test/pessoa.jpg',
              })
            ),
          },
        },
      ],
    });

    return {
      facade: TestBed.inject(DirectChatSelectionContextFacade),
      selectChat,
      clearSelection,
    };
  }

  it('sincroniza seleção local com DirectChatFacade', () => {
    const { facade, selectChat } = setup();

    facade.select(' chat-1 ', 'chat');

    expect(facade.selectedChatId()).toBe('chat-1');
    expect(facade.selectedType()).toBe('chat');
    expect(selectChat).toHaveBeenCalledWith('chat-1');
  });

  it('resolve peer da conversa quando não há contexto visual explícito', async () => {
    const { facade } = setup();
    facade.select('chat-1', 'chat');

    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-1');
  });

  it('ignora metadata divergente e usa os participantes canônicos para envio', async () => {
    const { facade } = setup();
    facade.select('chat-1', 'chat');
    facade.applyPeer({
      peerUid: 'peer-explicito',
      peerName: 'Explícito',
    });

    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-1');

    await firstValueFrom(facade.syncPeerContext$(of('me')));
    expect(facade.activePeerUid()).toBe('peer-1');
    expect(facade.activePeerName()).toBe('Pessoa');
  });

  it('resolve identidade pública e atualiza contexto do peer', async () => {
    const { facade } = setup();

    await firstValueFrom(facade.resolvePeer$('peer-1'));

    expect(facade.activePeerUid()).toBe('peer-1');
    expect(facade.activePeerName()).toBe('Pessoa');
    expect(facade.activePeerPhotoURL()).toBe(
      'https://example.test/pessoa.jpg'
    );
  });

  it('sincroniza automaticamente identidade do peer selecionado', async () => {
    const { facade } = setup();

    facade.select('chat-1', 'chat');

    await firstValueFrom(facade.syncPeerContext$(of('me')));

    expect(facade.activePeerUid()).toBe('peer-1');
    expect(facade.activePeerName()).toBe('Pessoa');
  });

  it('limpa a identidade anterior ao selecionar outra conversa', () => {
    const { facade } = setup();
    facade.select('chat-1', 'chat');
    facade.applyPeer({
      peerUid: 'peer-1',
      peerName: 'Primeira pessoa',
      peerPhotoURL: 'https://example.test/primeira.jpg',
    });

    facade.select('chat-2', 'chat');

    expect(facade.activePeerUid()).toBeNull();
    expect(facade.activePeerName()).toBeNull();
    expect(facade.activePeerPhotoURL()).toBeNull();
  });

  it('não atribui o peer anterior à conversa nova enquanto aguarda o snapshot', async () => {
    const selectedChat$ = new BehaviorSubject<{
      id: string;
      participants: string[];
    } | null>({ id: 'chat-1', participants: ['me', 'peer-1'] });
    const { facade } = setup({ selectedChat$ });

    facade.select('chat-1', 'chat');
    facade.applyPeer({ peerUid: 'peer-1', peerName: 'Primeira pessoa' });

    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-1');

    facade.select('chat-2', 'chat');
    // The canonical facade is still returning the old chat.
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBeNull();

    selectedChat$.next({ id: 'chat-2', participants: ['me', 'peer-2'] });
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-2');
  });

  it('não libera peer sem sessão, vínculo de participantes ou seleção válida', async () => {
    const selectedChat$ = new BehaviorSubject<{
      id: string;
      participants: string[];
    } | null>({ id: 'chat-1', participants: ['me', 'peer-1'] });
    const { facade } = setup({ selectedChat$ });

    facade.select('chat-1', 'chat');
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of(null)))
    ).resolves.toBeNull();

    selectedChat$.next({ id: 'chat-1', participants: ['outro', 'peer-1'] });
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBeNull();

    selectedChat$.next({ id: 'chat-1', participants: ['me', 'me'] });
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBeNull();

    facade.clear();
    selectedChat$.next({ id: 'chat-1', participants: ['me', 'peer-1'] });
    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBeNull();
  });

  it('descarta resolução atrasada do peer anterior após mudança de conversa', () => {
    const oldPeer$ = new Subject<{
      uid: string;
      name: string | null;
      photoURL: string | null;
    } | null>();
    const { facade } = setup({
      resolvePeer$: () => oldPeer$,
    });

    facade.select('chat-1', 'chat');
    const subscription = facade.resolvePeer$('peer-1').subscribe();
    facade.select('chat-2', 'chat');
    facade.applyPeer({
      peerUid: 'peer-2',
      peerName: 'Segunda pessoa',
      peerPhotoURL: 'https://example.test/segunda.jpg',
    });
    oldPeer$.next({
      uid: 'peer-1',
      name: 'Primeira pessoa',
      photoURL: 'https://example.test/primeira.jpg',
    });

    expect(facade.activePeerUid()).toBe('peer-2');
    expect(facade.activePeerName()).toBe('Segunda pessoa');
    expect(facade.activePeerPhotoURL()).toContain('segunda.jpg');
    subscription.unsubscribe();
  });

  it('clear limpa seleção, contexto e facade canônica', () => {
    const { facade, clearSelection } = setup();

    facade.select('chat-1', 'chat');
    facade.applyPeer({
      peerUid: 'peer-1',
      peerName: 'Pessoa',
      peerPhotoURL: 'photo',
    });

    facade.clear();

    expect(facade.selectedChatId()).toBeNull();
    expect(facade.selectedType()).toBeNull();
    expect(facade.activePeerUid()).toBeNull();
    expect(facade.activePeerName()).toBeNull();
    expect(facade.activePeerPhotoURL()).toBeNull();
    expect(clearSelection).toHaveBeenCalled();
  });
});
