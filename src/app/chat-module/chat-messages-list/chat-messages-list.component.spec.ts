// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ChatMessagesListComponent } from './chat-messages-list.component';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { DateTimeService } from '../../core/services/general/date-time.service';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from '../../messaging/direct-chat/application/direct-thread.facade';

describe('ChatMessagesListComponent', () => {
  let fixture: ComponentFixture<ChatMessagesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatMessagesListComponent],
      providers: [
        {
          provide: DirectChatFacade,
          useValue: {
            selectChat: vi.fn(),
          },
        },
        {
          provide: DirectThreadFacade,
          useValue: {
            state$: of({ chatId: 'c1', messages: [] }),
            markVisibleMessagesAsRead$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: RoomMessagesService,
          useValue: {
            getRoomMessages: vi.fn(() => of([])),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
        {
          provide: DateTimeService,
          useValue: {
            formatRelativeTime: vi.fn(() => 'agora'),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('test-uid'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatMessagesListComponent);
    fixture.componentRef.setInput('chatId', 'c1');
    fixture.componentRef.setInput('type', 'chat');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
