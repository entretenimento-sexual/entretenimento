// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ChatMessagesListComponent } from './chat-messages-list.component';
import { ChatService } from '../../core/services/batepapo/chat-service/chat.service';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';

describe('ChatMessagesListComponent', () => {
  let fixture: ComponentFixture<ChatMessagesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatMessagesListComponent],
      providers: [
        {
          provide: ChatService,
          useValue: {
            monitorChat: vi.fn(() => of([])),
            updateMessageStatus: vi.fn(() => of(void 0)),
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
