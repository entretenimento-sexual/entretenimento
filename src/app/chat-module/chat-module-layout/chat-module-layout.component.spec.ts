import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;
  let authUid$: BehaviorSubject<string | null>;
  let selectedChatId$: BehaviorSubject<string | null>;
  let selectedType$: BehaviorSubject<'chat' | null>;

  beforeEach(async () => {
    authUid$ = new BehaviorSubject<string | null>('u1');
    selectedChatId$ = new BehaviorSubject<string | null>(null);
    selectedType$ = new BehaviorSubject<'chat' | null>(null);
    await TestBed.configureTestingModule({
      declarations: [ChatModuleLayoutComponent],
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

  it('mantém editor somente leitura quando envio não está autorizado e libera após autorização', () => {
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

  it('não limpa rascunho da nova conversa após resposta atrasada de envio', () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string; blockedReason: null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'texto para A';
    component.sendMessage();
    expect(orchestrator.send$).toHaveBeenCalledWith('chat-1', 'texto para A');

    selection.selectedChatId.mockReturnValue('chat-2');
    selectedChatId$.next('chat-2');
    component.messageContent = 'rascunho para B';
    pending.next({ messageId: 'sent-A', blockedReason: null });
    expect(component.messageContent).toBe('rascunho para B');
    expect(component.directMessageBlockedReason()).toBeNull();
  });

  it('não apaga texto atualizado enquanto o envio antigo está pendente', () => {
    const selection = fixture.debugElement.injector.get(DirectChatSelectionContextFacade) as any;
    const orchestrator = fixture.debugElement.injector.get(DirectChatSendOrchestrator) as any;
    const pending = new Subject<{ messageId: string; blockedReason: null }>();
    orchestrator.send$.mockReturnValueOnce(pending.asObservable());
    selection.selectedChatId.mockReturnValue('chat-1');
    selection.selectedType.mockReturnValue('chat');
    component.canSendCurrentMessage.set(true);
    component.messageContent = 'texto original';
    component.sendMessage();

    component.messageContent = 'texto atualizado';
    pending.next({ messageId: 'sent-1', blockedReason: null });
    expect(component.messageContent).toBe('texto atualizado');
    expect(component.isSendingMessage()).toBe(true);
    pending.complete();
    expect(component.isSendingMessage()).toBe(false);
  });

  it('cancela envio pendente no logout sem apagar rascunho da conta seguinte', () => {
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
    component.sendMessage();
    expect(component.isSendingMessage()).toBe(true);

    authUid$.next(null);
    expect(component.isSendingMessage()).toBe(false);
    authUid$.next('u2');
    component.messageContent = 'rascunho de B';
    pending.next({ messageId: 'envio-A', blockedReason: null });
    expect(component.messageContent).toBe('rascunho de B');
    expect(component.directMessageBlockedReason()).toBeNull();
  });

  it('mantém o rascunho quando o envio falha e encerra o indicador', () => {
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
    component.sendMessage();
    pending.next({ messageId: null, blockedReason: 'Falha de envio' });
    pending.complete();
    expect(component.isSendingMessage()).toBe(false);
    expect(component.messageContent).toBe('não perder este texto');
    expect(component.directMessageBlockedReason()).toBe('Falha de envio');
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
