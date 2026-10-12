// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';

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
  let loadOlderMessages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    uid$ = new BehaviorSubject<string | null>('test-uid');
    threadState$ = new BehaviorSubject({ chatId: 'c1', messages: [] as any[] });
    selectChat = vi.fn();
    loadOlderMessages = vi.fn(() => of([]));
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
            loadOlderMessages$: loadOlderMessages,
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

  it('acumula a página histórica sem duplicar mensagens e preserva a janela realtime', () => {
    const timestamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    const incoming = Array.from({ length: 20 }, (_, index) => ({
      id: `new-${index}`, timestamp: timestamp(100 + index), content: 'recente',
    }));
    threadState$.next({ chatId: 'c1', messages: incoming });
    loadOlderMessages.mockReturnValue(of([
      { id: 'older', timestamp: timestamp(90), content: 'antiga' },
      { ...incoming[0] },
    ]));

    fixture.componentInstance.loadOlderMessages();

    expect(loadOlderMessages).toHaveBeenCalledWith('c1', incoming[0].timestamp, incoming[0].id);
    expect(fixture.componentInstance.messages[0].id).toBe('older');
    expect(fixture.componentInstance.messages).toHaveLength(21);
    expect(fixture.componentInstance.hasMoreHistory).toBe(false);

    threadState$.next({ chatId: 'c1', messages: [
      ...incoming, { id: 'newest', timestamp: timestamp(121), content: 'última' },
    ] });
    expect(fixture.componentInstance.messages).toHaveLength(22);
    expect(fixture.componentInstance.messages[0].id).toBe('older');
    expect(fixture.componentInstance.messages[21].id).toBe('newest');
  });

  it('descarta página pendente quando a sessão é encerrada', () => {
    const timestamp = { seconds: 100, nanoseconds: 0 };
    const pending = new Subject<any[]>();
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'm1', timestamp, content: 'atual' },
    ] });
    loadOlderMessages.mockReturnValue(pending.asObservable());

    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.loadingOlderMessages).toBe(true);

    uid$.next(null);
    pending.next([{ id: 'private-old', timestamp: { seconds: 10, nanoseconds: 0 } }]);
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.loadingOlderMessages).toBe(false);
    expect(pending.observed).toBe(false);
  });

  it('mantém retry disponível quando o histórico falha', () => {
    const timestamp = { seconds: 100, nanoseconds: 0 };
    threadState$.next({ chatId: 'c1', messages: [{ id: 'm1', timestamp }] });
    loadOlderMessages.mockReturnValue(throwError(() => new Error('offline')));

    fixture.componentInstance.loadOlderMessages();

    expect(fixture.componentInstance.historyLoadError).toBe(true);
    expect(fixture.componentInstance.loadingOlderMessages).toBe(false);
    expect(fixture.componentInstance.hasMoreHistory).toBe(true);
    expect(fixture.componentInstance.messages.map(message => message.id)).toEqual(['m1']);
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
