// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessagesListComponent } from './chat-messages-list.component';
import { of } from 'rxjs';
import { ChatService } from '../../core/services/batepapo/chat-service/chat.service';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { AuthService } from '../../core/services/autentication/auth.service';

describe('ChatMessagesListComponent', () => {
  let fixture: ComponentFixture<ChatMessagesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatMessagesListComponent], // 👈 não-standalone
      providers: [
        { provide: ChatService, useValue: { monitorChat: jest.fn(() => of([])), updateMessageStatus: jest.fn() } },
        { provide: RoomMessagesService, useValue: { getRoomMessages: jest.fn(() => of([])) } },
        { provide: ErrorNotificationService, useValue: { showError: jest.fn() } },
        { provide: AuthService, useValue: { currentUser: { uid: 'test-uid' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatMessagesListComponent);
    fixture.componentRef.setInput('chatId', 'c1');   // 👈 inputs obrigatórios
    fixture.componentRef.setInput('type', 'chat');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
