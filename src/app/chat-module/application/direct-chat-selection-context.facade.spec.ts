import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatNavigationOrchestrator } from './direct-chat-navigation.orchestrator';
import { DirectChatSelectionContextFacade } from './direct-chat-selection-context.facade';

describe('DirectChatSelectionContextFacade', () => {
  function setup() {
    const selectChat = vi.fn();
    const clearSelection = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        DirectChatSelectionContextFacade,
        {
          provide: DirectChatFacade,
          useValue: {
            selectedChat$: of({
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
            resolvePeer$: vi.fn(() =>
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

    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-1');
  });

  it('contexto visual explícito prevalece sobre participantes da conversa', async () => {
    const { facade } = setup();

    facade.applyPeer({
      peerUid: 'peer-explicito',
      peerName: 'Explícito',
    });

    await expect(
      firstValueFrom(facade.selectedDirectPeerUid$(of('me')))
    ).resolves.toBe('peer-explicito');
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
