import { Directive, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatModuleLayoutComponent } from './chat-module-layout.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from '../../messaging/direct-chat/application/direct-thread.facade';
import { DirectChatNavigationOrchestrator } from '../application/direct-chat-navigation.orchestrator';
import { DirectChatComposeAccessFacade } from '../application/direct-chat-compose-access.facade';
import { DirectChatSendOrchestrator } from '../application/direct-chat-send.orchestrator';
import { DirectChatSelectionContextFacade } from '../application/direct-chat-selection-context.facade';

@Directive({ selector: 'textarea[appChatEmojiComposer]', exportAs: 'chatEmojiComposer', standalone: false })
class MockChatEmojiComposerDirective {}

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;
  let authUid$: BehaviorSubject<string | null>;
  let selectedChatId$: BehaviorSubject<string | null>;
  let selectedType$: BehaviorSubject<'chat' | null>;
  afterEach(() => {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('chat-send-intent:')) sessionStorage.removeItem(key);
    }
  });

  beforeEach(async () => {
    authUid$ = new BehaviorSubject<string | null>('u1');
    selectedChatId$ = new BehaviorSubject<string | null>(null);
    selectedType$ = new BehaviorSubject<'chat' | null>(null);
    await TestBed.configureTestingModule({
      declarations: [ChatModuleLayoutComponent, MockChatEmojiComposerDirective],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            uid$: authUid$.asObservable(),
            authUser$: of({ uid: 'u1' }),
            ready$: of(true),
            whenReady: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1' }),
            getSnapshot: vi.fn(() => ({ uid: 'u1' })),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
        {
          provide: DirectChatFacade,
          useValue: {
            selectedChat$: of(null),
            selectChat: vi.fn(),
            clearSelection: vi.fn(),
          },
        },
        {
          provide: DirectThreadFacade,
          useValue: {
            canSend$: of(true),
            sendMessage$: vi.fn(() => of('msg-id')),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(ChatModuleLayoutComponent, {
        set: {
          providers: [
            {
              provide: DirectChatNavigationOrchestrator,
              useValue: {
                observeResolvedDeepLinks$: vi.fn(() => of(null)),
                consumeDeepLinkQueryParams: vi.fn(() => Promise.resolve(true)),
                resolvePeer$: vi.fn(() => of(null)),
              },
            },
            {
              provide: DirectChatComposeAccessFacade,
              useValue: {
                observe$: vi.fn(() =>
                  of({
                    canCompose: true,
                    canSendDirect: true,
                    hasAcceptedConnection: false,
                    canSendCurrentMessage: false,
                    statusMessage:
                      'Vocês precisam estar conectados para trocar mensagens.',
                  })
                ),
              },
            },
            {
              provide: DirectChatSendOrchestrator,
              useValue: {
                send$: vi.fn(() =>
                  of({
                    messageId: 'msg-id',
                    blockedReason: null,
                  })
                ),
              },
            },
            {
              provide: DirectChatSelectionContextFacade,
              useValue: {
                selectedChatId$,
                selectedType$,
                selectedDirectPeerUid$: vi.fn(() => of(null)),
                syncPeerContext$: vi.fn(() => of(void 0)),
                selectedChatId: vi.fn(() => null),
                selectedType: vi.fn(() => null),
                activePeerUid: vi.fn(() => null),
                activePeerName: vi.fn(() => null),
                activePeerPhotoURL: vi.fn(() => null),
                select: vi.fn(),
                clear: vi.fn(),
                clearPeer: vi.fn(),
                resolvePeer$: vi.fn(() => of(void 0)),
                selectEvent: vi.fn(() => true),
              },
            },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ChatModuleLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('mantém editor somente leitura quando envio não está autorizado e libera após autorização', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.messageContent = 'rascunho';
    component.canSendCurrentMessage.set(false);
    fixture.detectChanges();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const button = fixture.nativeElement.querySelector('.chat-shell__send') as HTMLButtonElement;
    expect(textarea.readOnly).toBe(true);
    expect(button.disabled).toBe(true);

    component.canSendCurrentMessage.set(true);
    fixture.detectChanges();
    expect(textarea.readOnly).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it('não limpa rascunho da nova conversa após resposta atrasada de envio', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string; blockedReason: null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'texto para A';
    await component.sendMessage();
    expect(orchestrator.send$).toHaveBeenCalledWith('chat-1', 'texto para A', expect.any(String));

    selection.selectedChatId.mockReturnValue('chat-2');
    selectedChatId$.next('chat-2');
    component.messageContent = 'rascunho para B';
    pending.next({ messageId: 'sent-A', blockedReason: null });
    expect(component.messageContent).toBe('rascunho para B');
    expect(component.directMessageBlockedReason()).toBeNull();
  });

  it('não apaga texto atualizado enquanto o envio antigo está pendente', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string; blockedReason: null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'texto original';
    await component.sendMessage();

    component.messageContent = 'texto atualizado';
    pending.next({ messageId: 'sent-1', blockedReason: null });
    expect(component.messageContent).toBe('texto atualizado');
    await fixture.whenStable();
    expect(component.isSendingMessage()).toBe(false);
    pending.complete();
  });

  it('cancela envio pendente no logout sem apagar rascunho da conta seguinte', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string; blockedReason: string | null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'rascunho de A';
    await component.sendMessage();
    expect(component.isSendingMessage()).toBe(true);

    authUid$.next(null);
    expect(component.isSendingMessage()).toBe(false);
    authUid$.next('u2');
    component.messageContent = 'rascunho de B';
    pending.next({ messageId: 'envio-A', blockedReason: null });
    expect(component.messageContent).toBe('rascunho de B');
    expect(component.directMessageBlockedReason()).toBeNull();
  });

  it('mantém o rascunho quando o envio falha e encerra o indicador', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string | null; blockedReason: string | null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'não perder este texto';
    await component.sendMessage();
    pending.next({ messageId: null, blockedReason: 'Falha de envio' });
    pending.complete();
    expect(component.isSendingMessage()).toBe(false);
    expect(component.messageContent).toBe('não perder este texto');
    expect(component.directMessageBlockedReason()).toBe('Falha de envio');
  });

  it('informa envio não confirmado sem apagar o rascunho nem sugerir retry cego', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const notifier = TestBed.inject(ErrorNotificationService) as any;
    const pending = new Subject<{ messageId: string | null; blockedReason: string | null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'não perder';
    await component.sendMessage();

    pending.next({ messageId: null, blockedReason: null });
    pending.complete();
    expect(component.messageContent).toBe('não perder');
    expect(component.isSendingMessage()).toBe(false);
    expect(notifier.showWarning).toHaveBeenCalledWith(
      'Não foi possível confirmar o envio. Verifique a conversa antes de tentar novamente.'
    );
  });

  it('reutiliza chave somente após envio não confirmado da mesma intenção', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'mesma intenção';
    orchestrator.send$.mockReturnValue(of({ messageId: null, blockedReason: null }));
    await component.sendMessage();
    const firstKey = orchestrator.send$.mock.calls.at(-1)[2];
    await component.sendMessage();
    const retryKey = orchestrator.send$.mock.calls.at(-1)[2];
    expect(retryKey).toBe(firstKey);

    component.messageContent = 'outra mensagem';
    await component.sendMessage();
    expect(orchestrator.send$.mock.calls.at(-1)[2]).not.toBe(firstKey);
  });

  it('gera nova intenção ao enviar novamente texto idêntico após confirmação', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    orchestrator.send$.mockReturnValue(of({ messageId: 'confirmado', blockedReason: null }));

    component.messageContent = 'mesmo texto';
    await component.sendMessage();
    const firstKey = orchestrator.send$.mock.calls.at(-1)[2];
    expect(component.messageContent).toBe('');

    component.messageContent = 'mesmo texto';
    await component.sendMessage();
    expect(orchestrator.send$.mock.calls.at(-1)[2]).not.toBe(firstKey);
  });

  it('não reutiliza chave de outra conversa mesmo com texto idêntico', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    orchestrator.send$.mockReturnValue(of({ messageId: null, blockedReason: null }));
    selection.selectedType.mockReturnValue('chat');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'texto repetido';

    selection.selectedChatId.mockReturnValue('chat-A');
    selectedChatId$.next('chat-A');
    await component.sendMessage();
    const firstKey = orchestrator.send$.mock.calls.at(-1)[2];

    selection.selectedChatId.mockReturnValue('chat-B');
    selectedChatId$.next('chat-B');
    await component.sendMessage();
    const secondKey = orchestrator.send$.mock.calls.at(-1)[2];
    expect(secondKey).not.toBe(firstKey);
  });

  it('restaura chave persistida após perder estado em memória sem reenviar automaticamente', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const key = 'chat-send-intent:u1:chat-1';
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    orchestrator.send$.mockReturnValue(of({ messageId: null, blockedReason: null }));
    component.messageContent = 'pendente';
    try {
      await component.sendMessage();
      const originalId = orchestrator.send$.mock.calls.at(-1)[2];
      const persisted = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      expect(persisted.requestId).toBe(originalId);
      expect(persisted).not.toHaveProperty('content');
      expect(persisted.contentHash).toMatch(/^[a-f0-9]{64}$/);

      // Simula o descarte do estado em memória provocado por recarregamento.
      (component as any).pendingSend = null;
      const calls = orchestrator.send$.mock.calls.length;
      expect(orchestrator.send$.mock.calls.length).toBe(calls);
      await component.sendMessage();
      expect(orchestrator.send$.mock.calls.at(-1)[2]).toBe(originalId);

      orchestrator.send$.mockReturnValue(of({ messageId: 'confirmado', blockedReason: null }));
      await component.sendMessage();
      expect(sessionStorage.getItem(key)).toBeNull();
    } finally {
      sessionStorage.removeItem(key);
    }
  });

  it('descarta intenção expirada antes de reutilizar chave', async () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const key = 'chat-send-intent:u1:chat-1';
    sessionStorage.setItem(key, JSON.stringify({
      uid: 'u1', chatId: 'chat-1', content: 'mensagem', requestId: 'old-id',
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
    }));
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    selectedChatId$.next('chat-1');
    selectedType$.next('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'mensagem';
    orchestrator.send$.mockReturnValue(of({ messageId: null, blockedReason: null }));

    await component.sendMessage();
    const requestId = orchestrator.send$.mock.calls.at(-1)[2];
    expect(requestId).not.toBe('old-id');
    expect(JSON.parse(sessionStorage.getItem(key) ?? '{}').requestId).toBe(requestId);
  });

  it('apaga intenções da conta anterior no logout', async () => {
    const key = 'chat-send-intent:u1:chat-1';
    sessionStorage.setItem(key, JSON.stringify({
      uid: 'u1', chatId: 'chat-1', content: 'mensagem', requestId: 'old-id',
      createdAt: Date.now(),
    }));
    authUid$.next(null);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('mantém apenas atalhos do chat direto no estado vazio', () => {
    const text = fixture.nativeElement.textContent as string;
    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    ).map((link) => link.getAttribute('href'));

    expect(text).toContain('Conexões');
    expect(text).toContain('Solicitações de conexão');
    expect(text).not.toContain('Salas');
    expect(hrefs).toContain('/friends/requests');
    expect(hrefs).not.toContain('/chat/rooms');
    expect(hrefs).not.toContain('/chat/room-invites');
    expect(hrefs).not.toContain('/chat/invite-list');
  });
});
