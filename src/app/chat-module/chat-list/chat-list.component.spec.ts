// src/app/chat-module/chat-list/chat-list.component.spec.ts
// -----------------------------------------------------------------------------
// CHAT LIST — DIRECT-ONLY REGRESSION
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - removidos mocks/testes de RoomService, RoomMessagesService,
//   RoomManagementService, InviteService e encerramento de Sala;
// - motivo: Salas foram retiradas da inbox ativa e permanecem somente na rota
//   legada /chat/rooms para histórico/encerramento seguro.
// - estes testes agora protegem o contrato atual: a inbox seleciona apenas chat
//   direto e não depende da infraestrutura de Salas.
// -----------------------------------------------------------------------------

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';

import { ChatListComponent } from './chat-list.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { PublicUserPreviewTriggerDirective } from '../../core/components/public-user-preview-popover/public-user-preview-trigger.directive';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { ContentStateComponent } from '../../shared/content-state/content-state.component';
import type { DirectChatInboxState, DirectChatListItem } from '../../messaging/direct-chat/models/direct-chat.models';

const DIRECT_ITEMS_CONTEXT =
  'ChatList.directChatItems' + String.fromCharCode(36);

describe('ChatListComponent', () => {
  let component: ChatListComponent;
  let fixture: ComponentFixture<ChatListComponent>;
  let selectChatMock: ReturnType<typeof vi.fn>;
  let applicationErrorReportMock: ReturnType<typeof vi.fn>;
  let inbox$: BehaviorSubject<DirectChatInboxState>;
  let loadMoreMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectChatMock = vi.fn();
    applicationErrorReportMock = vi.fn();
    loadMoreMock = vi.fn();
    inbox$ = new BehaviorSubject<DirectChatInboxState>({
      items: [], status: 'ready', hasMore: false, unconfirmedCount: 0, directUnreadCount: 0,
    });

    TestBed.configureTestingModule({
      declarations: [ChatListComponent],
      imports: [
        FormsModule,
        ContentStateComponent,
        PublicUserPreviewTriggerDirective,
      ],
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            ready$: of(true),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            canListenRealtime$: of(true),
          },
        },
        {
          provide: DirectChatFacade,
          useValue: {
            items$: of([]),
            observeProgressiveInbox$: (more$: import('rxjs').Observable<unknown>) => {
              more$.subscribe(loadMoreMock);
              return inbox$;
            },
            selectChat: selectChatMock,
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: {
            report: applicationErrorReportMock,
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(ChatListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('cria a inbox de conversas diretas sem infraestrutura de Salas', () => {
    expect(component).toBeTruthy();
  });

  it('não anuncia lista vazia quando há uma página seguinte e oferece controle acessível', () => {
    inbox$.next({ ...inbox$.value, hasMore: true });
    fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
      .find(node => node.textContent?.includes('Carregar mais conversas'));
    expect(button).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Nenhuma conversa ainda');
    button?.click();
    expect(loadMoreMock).toHaveBeenCalledTimes(1);
  });

  it('seleciona somente o contrato de chat direto', () => {
    const selected = vi.fn();
    component.chatSelected.subscribe(selected);
    component.activeType = 'chat';

    const chat = {
      id: 'chat-u1-u2',
      otherParticipantUid: 'u2',
      otherParticipantNickname: 'Pessoa 2',
      otherParticipantPhotoURL: null,
      unreadCount: 1,
    } as unknown as DirectChatListItem;

    component.selectChat(chat);

    expect(selectChatMock).toHaveBeenCalledWith('chat-u1-u2');
    expect(selected).toHaveBeenCalledWith({
      id: 'chat-u1-u2',
      type: 'chat',
      peerUid: 'u2',
      peerName: 'Pessoa 2',
      peerPhotoURL: null,
    });
  });

  it('não reemite a conversa direta já selecionada', () => {
    const selected = vi.fn();
    component.chatSelected.subscribe(selected);
    component.activeType = 'chat';
    component.activeChatId = 'chat-u1-u2';

    component.selectChat({
      id: 'chat-u1-u2',
      otherParticipantUid: 'u2',
    } as unknown as DirectChatListItem);

    expect(selectChatMock).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });

  it('mantém erro de stream explicitamente silencioso', () => {
    const error = new Error('stream failed');

    (
      component as unknown as {
        handleError(
          context: string,
          error: unknown,
          notifyUser: boolean
        ): void;
      }
    ).handleError(DIRECT_ITEMS_CONTEXT, error, false);

    expect(applicationErrorReportMock).toHaveBeenCalledTimes(1);
    expect(applicationErrorReportMock).toHaveBeenCalledWith(error, {
      feature: 'chat-list',
      operation: DIRECT_ITEMS_CONTEXT,
      fallbackMessage: 'Falha ao carregar o chat. Tente novamente.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatListComponent',
        context: DIRECT_ITEMS_CONTEXT,
      },
    });
  });

  it('preserva feedback visível quando a fronteira solicitar notificação', () => {
    const error = new Error('visible failure');

    (
      component as unknown as {
        handleError(
          context: string,
          error: unknown,
          notifyUser: boolean
        ): void;
      }
    ).handleError('ChatList.load', error, true);

    expect(applicationErrorReportMock).toHaveBeenCalledTimes(1);
    expect(applicationErrorReportMock).toHaveBeenCalledWith(error, {
      feature: 'chat-list',
      operation: 'ChatList.load',
      fallbackMessage: 'Falha ao carregar o chat. Tente novamente.',
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'ChatListComponent',
        context: 'ChatList.load',
      },
    });
  });
});
