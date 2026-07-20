// src/app/chat-module/chat-list/chat-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { ChatListComponent } from './chat-list.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { RoomService } from '../../core/services/batepapo/room-services/room.service';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { InviteService } from '../../core/services/batepapo/invite-service/invite.service';
import { ChatNotificationService } from '../../core/services/batepapo/chat-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { ActionStateDirective } from '../../shared/action-state/action-state.directive';
import { ContentStateComponent } from '../../shared/content-state/content-state.component';

describe('ChatListComponent', () => {
  let component: ChatListComponent;
  let fixture: ComponentFixture<ChatListComponent>;
  let dialogOpenMock: ReturnType<typeof vi.fn>;
  let deleteRoomMock: ReturnType<typeof vi.fn>;
  let showSuccessMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dialogOpenMock = vi.fn(() => ({ afterClosed: () => of(null) }));
    deleteRoomMock = vi.fn(() => Promise.resolve());
    showSuccessMock = vi.fn();

    TestBed.configureTestingModule({
      declarations: [ChatListComponent],
      imports: [FormsModule, ActionStateDirective, ContentStateComponent],
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            ready$: of(true),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1', role: 'basic' }),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            canRunChatRealtime$: of(true),
            canListenRealtime$: of(true),
          },
        },
        {
          provide: DirectChatFacade,
          useValue: {
            items$: of([]),
            selectChat: vi.fn(),
          },
        },
        {
          provide: RoomService,
          useValue: {
            getRooms: vi.fn(() => of([])),
          },
        },
        {
          provide: RoomMessagesService,
          useValue: {
            getRoomMessages: vi.fn(() => of([])),
            updateMessageStatus: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: ChatNotificationService,
          useValue: {
            decrementUnreadMessages: vi.fn(),
          },
        },
        {
          provide: RoomManagementService,
          useValue: {
            deleteRoom: deleteRoomMock,
          },
        },
        {
          provide: InviteService,
          useValue: {
            sendInviteToRoom: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: dialogOpenMock,
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
            showSuccess: showSuccessMock,
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('confirma o encerramento lógico da Sala e informa sucesso', async () => {
    dialogOpenMock.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteRoom('room-1', new MouseEvent('click'));
    await Promise.resolve();
    await Promise.resolve();

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    const dialogConfig = dialogOpenMock.mock.calls[0]?.[1];
    expect(dialogConfig?.data?.title).toBe('Encerrar Sala');
    expect(dialogConfig?.data?.message).toContain(
      'histórico será preservado'
    );
    expect(deleteRoomMock).toHaveBeenCalledTimes(1);
    expect(deleteRoomMock).toHaveBeenCalledWith('room-1');
    expect(showSuccessMock).toHaveBeenCalledWith(
      'Sala encerrada com sucesso.'
    );
  });

  it('não encerra a Sala quando a confirmação é cancelada', async () => {
    dialogOpenMock.mockReturnValue({ afterClosed: () => of(false) });

    component.deleteRoom('room-1', new MouseEvent('click'));
    await Promise.resolve();

    expect(deleteRoomMock).not.toHaveBeenCalled();
  });
});
