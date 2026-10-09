// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';

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
  let uid$: BehaviorSubject<string | null>;
  let threadState$: BehaviorSubject<{ chatId: string; messages: any[] }>;
  let selectChat: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    uid$ = new BehaviorSubject<string | null>('test-uid');
    threadState$ = new BehaviorSubject({ chatId: 'c1', messages: [] as any[] });
    selectChat = vi.fn();
    await TestBed.configureTestingModule({
      declarations: [ChatMessagesListComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        {
          provide: DirectChatFacade,
          useValue: {
            selectChat,
          },
        },
        {
          provide: DirectThreadFacade,
          useValue: {
            state$: threadState$,
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
            uid$,
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

  it('limpa mensagens imediatamente no logout e não reabre thread antiga na troca de conta', () => {
    threadState$.next({ chatId: 'c1', messages: [{ id: 'm1', senderId: 'test-uid', content: 'privado' }] });
    expect(fixture.componentInstance.messages.length).toBe(1);
    const selectionsBefore = selectChat.mock.calls.length;

    uid$.next(null);
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.threadItems).toEqual([]);
    expect(fixture.componentInstance.pendingIncomingCount).toBe(0);

    uid$.next('another-uid');
    threadState$.next({ chatId: 'c1', messages: [{ id: 'm2', senderId: 'test-uid', content: 'atrasada' }] });
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(selectChat.mock.calls.length).toBe(selectionsBefore);
  });
});
