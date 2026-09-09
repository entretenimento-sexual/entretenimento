// src/app/chat-module/chat-list/chat-list.component.spec.ts
// -----------------------------------------------------------------------------
// CHAT LIST — DIRECT-ONLY REGRESSION
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - removidos mocks/testes de RoomService, RoomMessagesService,
//   RoomManagementService, InviteService e encerramento de Sala;
// - motivo: Salas foram retiradas da inbox ativa e permanecem somente na rota
//   legada `/chat/rooms` para histórico/encerramento seguro.
// - estes testes agora protegem o contrato atual: a inbox seleciona apenas chat
//   direto e não depende da infraestrutura de Salas.
// -----------------------------------------------------------------------------

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { ChatListComponent } from './chat-list.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { PublicUserPreviewTriggerDirective } from '../../core/components/public-user-preview-popover/public-user-preview-trigger.directive';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { ContentStateComponent } from '../../shared/content-state/content-state.component';
import type { DirectChatListItem } from '../../messaging/direct-chat/models/direct-chat.models';

describe('ChatListComponent', () => {
  let component: ChatListComponent;
  let fixture: ComponentFixture<ChatListComponent>;
  let selectChatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectChatMock = vi.fn();

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
            canRunChatRealtime$: of(true),
          },
        },
        {
          provide: DirectChatFacade,
          useValue: {
            items$: of([]),
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
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
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
});
