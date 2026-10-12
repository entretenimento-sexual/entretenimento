// src/app/chat-module/chat-messages-list/chat-messages-list.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';

import { ChatMessagesListComponent } from './chat-messages-list.component';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
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
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
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

  it('retenta falha de rede e limpa o estado de erro no sucesso', () => {
    const timestamp = { seconds: 100, nanoseconds: 0 };
    threadState$.next({ chatId: 'c1', messages: [{ id: 'm1', timestamp }] });
    loadOlderMessages.mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of([{ id: 'old', timestamp: { seconds: 50, nanoseconds: 0 } }]));

    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.historyLoadError).toBe(true);
    expect(fixture.componentInstance.hasMoreHistory).toBe(true);
    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.historyLoadError).toBe(false);
    expect(fixture.componentInstance.loadingOlderMessages).toBe(false);
    expect(fixture.componentInstance.messages.map(m => m.id)).toEqual(['old', 'm1']);
    expect(loadOlderMessages).toHaveBeenCalledTimes(2);
  });

  it.each(['permission-denied', 'unauthenticated'])(
    'revoga acesso e limpa mensagens após erro %s na paginação',
    (code) => {
      const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
      threadState$.next({ chatId: 'c1', messages: [{ id: 'private', timestamp: stamp(100) }] });
      loadOlderMessages.mockReturnValue(throwError(() => ({ code })));

      fixture.componentInstance.loadOlderMessages();

      expect(fixture.componentInstance.messages).toEqual([]);
      expect(fixture.componentInstance.loadingOlderMessages).toBe(false);
      expect(fixture.componentInstance.historyLoadError).toBe(false);
      fixture.componentInstance.loadOlderMessages();
      expect(loadOlderMessages).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['permission-denied', 'unauthenticated'])(
    'revoga acesso e limpa mensagens após erro %s na recuperação da lacuna',
    (code) => {
      const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
      threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
      threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
      loadOlderMessages.mockReturnValue(throwError(() => ({ code })));

      fixture.componentInstance.recoverHistoryGap();

      expect(fixture.componentInstance.messages).toEqual([]);
      expect(fixture.componentInstance.historyGap).toBe(false);
      expect(fixture.componentInstance.loadingGap).toBe(false);
      fixture.componentInstance.recoverHistoryGap();
      expect(loadOlderMessages).toHaveBeenCalledTimes(1);
    },
  );

  it('apaga histórico acumulado quando a facade revoga a thread', () => {
    const timestamp = { seconds: 100, nanoseconds: 0 };
    threadState$.next({ chatId: 'c1', messages: [{ id: 'm1', timestamp }] });
    loadOlderMessages.mockReturnValue(of([
      { id: 'old', timestamp: { seconds: 10, nanoseconds: 0 } },
    ]));
    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.messages.map(message => message.id)).toContain('old');

    threadState$.next({ chatId: '', messages: [] });
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.threadItems).toEqual([]);
  });

  it('encadeia páginas completas com timestamps iguais e cursor de ID estável', () => {
    const timestamp = { seconds: 100, nanoseconds: 0 };
    const initial = Array.from({ length: 20 }, (_, i) => ({
      id: `z${String(i).padStart(2, '0')}`, timestamp,
    }));
    threadState$.next({ chatId: 'c1', messages: initial });
    const firstPage = Array.from({ length: 20 }, (_, i) => ({
      id: `y${String(i).padStart(2, '0')}`, timestamp,
    }));
    const secondPage = Array.from({ length: 20 }, (_, i) => ({
      id: `x${String(i).padStart(2, '0')}`, timestamp,
    }));
    loadOlderMessages.mockReturnValueOnce(of(firstPage))
      .mockReturnValueOnce(of(secondPage));

    fixture.componentInstance.loadOlderMessages();
    expect(loadOlderMessages).toHaveBeenNthCalledWith(1, 'c1', timestamp, 'z00');
    expect(fixture.componentInstance.hasMoreHistory).toBe(true);

    fixture.componentInstance.loadOlderMessages();
    expect(loadOlderMessages).toHaveBeenNthCalledWith(2, 'c1', timestamp, 'y00');
    expect(fixture.componentInstance.messages).toHaveLength(60);
    expect(new Set(fixture.componentInstance.messages.map(m => m.id)).size).toBe(60);
    expect(fixture.componentInstance.messages[0].id).toBe('x00');
  });

  it('detecta nova mensagem recebida mesmo quando a janela continua com 60 documentos', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    const initial = Array.from({ length: 60 }, (_, i) => ({
      id: `m-${i}`, timestamp: stamp(i + 1), senderId: 'other-user',
    }));
    threadState$.next({ chatId: 'c1', messages: initial });
    threadState$.next({ chatId: 'c1', messages: [
      ...initial.slice(1), { id: 'm-new', timestamp: stamp(61), senderId: 'other-user' },
    ] });
    expect(fixture.componentInstance.messages.at(-1)?.id).toBe('m-new');
    expect(fixture.componentInstance.messages).toHaveLength(61);
    expect(fixture.componentInstance.messages[0]?.id).toBe('m-0');
  });

  it('não ressuscita histórico removido dentro do intervalo realtime autoritativo', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    const initial = [
      { id: 'oldest', timestamp: stamp(10) },
      { id: 'overlap', timestamp: stamp(20) },
      { id: 'latest', timestamp: stamp(30) },
    ];
    threadState$.next({ chatId: 'c1', messages: initial });
    loadOlderMessages.mockReturnValue(of([
      { id: 'historical', timestamp: stamp(5) },
      { id: 'overlap', timestamp: stamp(20) },
    ]));
    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.messages.map(m => m.id)).toContain('overlap');

    threadState$.next({ chatId: 'c1', messages: [
      { id: 'oldest', timestamp: stamp(10) },
      { id: 'latest', timestamp: stamp(30) },
    ] });
    expect(fixture.componentInstance.messages.map(m => m.id)).toEqual([
      'historical', 'oldest', 'latest',
    ]);
  });

  it('não acumula duas cópias da mesma expulsão após janela realtime oscilar', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    const original = Array.from({ length: 60 }, (_, i) => ({
      id: `m-${i}`, timestamp: stamp(i + 1), senderId: 'other-user',
    }));
    const shifted = [...original.slice(1), {
      id: 'm-60', timestamp: stamp(61), senderId: 'other-user',
    }];
    threadState$.next({ chatId: 'c1', messages: original });
    threadState$.next({ chatId: 'c1', messages: shifted });
    threadState$.next({ chatId: 'c1', messages: original });
    threadState$.next({ chatId: 'c1', messages: shifted });

    const accumulated = (fixture.componentInstance as any).olderMessages as any[];
    expect(accumulated.filter(message => message.id === 'm-0')).toHaveLength(1);
    expect(fixture.componentInstance.messages.filter(message => message.id === 'm-0')).toHaveLength(1);
  });

  it('preserva mensagem expulsa da janela de 60 sem confundi-la com exclusão', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    const initial = Array.from({ length: 60 }, (_, i) => ({
      id: `m-${i}`, timestamp: stamp(i + 1), senderId: 'other-user',
    }));
    threadState$.next({ chatId: 'c1', messages: initial });
    threadState$.next({ chatId: 'c1', messages: [
      ...initial.slice(1),
      { id: 'm-60', timestamp: stamp(61), senderId: 'other-user' },
    ] });
    expect(fixture.componentInstance.messages).toHaveLength(61);
    expect(fixture.componentInstance.messages[0].id).toBe('m-0');

    // A próxima remoção acontece DENTRO da janela, não por limite.
    threadState$.next({ chatId: 'c1', messages: [
      ...initial.slice(1, 25),
      ...initial.slice(26),
      { id: 'm-60', timestamp: stamp(61), senderId: 'other-user' },
    ] });
    const ids = fixture.componentInstance.messages.map(m => m.id);
    expect(ids).toContain('m-0');
    expect(ids).not.toContain('m-25');
  });

  it('não preserva histórico privado após snapshot vazio', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'm-1', timestamp: stamp(1) },
      { id: 'm-2', timestamp: stamp(2) },
    ] });
    loadOlderMessages.mockReturnValue(of([{ id: 'old', timestamp: stamp(0) }]));
    fixture.componentInstance.loadOlderMessages();
    threadState$.next({ chatId: 'c1', messages: [] });
    expect(fixture.componentInstance.messages).toEqual([]);
  });

  it('recupera lacuna em páginas completas e fecha ao alcançar o ponto conhecido', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'old-1', timestamp: stamp(1) },
      { id: 'old-2', timestamp: stamp(2) },
    ] });
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'recent-100', timestamp: stamp(100) },
      { id: 'recent-101', timestamp: stamp(101) },
    ] });
    expect(fixture.componentInstance.historyGap).toBe(true);

    loadOlderMessages.mockReturnValueOnce(of(
      Array.from({ length: 20 }, (_, i) => ({
        id: `bridge-${80 + i}`, timestamp: stamp(80 + i),
      }))
    )).mockReturnValueOnce(of([
      { id: 'bridge-3', timestamp: stamp(3) },
      { id: 'old-2', timestamp: stamp(2) },
    ]));
    fixture.componentInstance.recoverHistoryGap();
    expect(loadOlderMessages).toHaveBeenNthCalledWith(1, 'c1', stamp(100), 'recent-100');
    expect(fixture.componentInstance.historyGap).toBe(true);
    fixture.componentInstance.recoverHistoryGap();
    expect(loadOlderMessages).toHaveBeenNthCalledWith(2, 'c1', stamp(80), 'bridge-80');
    expect(fixture.componentInstance.historyGap).toBe(false);
    expect(fixture.componentInstance.messages.map(m => m.id)).toContain('bridge-3');
    expect(new Set(fixture.componentInstance.messages.map(m => m.id)).size)
      .toBe(fixture.componentInstance.messages.length);
  });

  it('encerra recuperação após página curta sem insistir em consultas vazias', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    loadOlderMessages.mockReturnValue(of([{ id: 'bridge', timestamp: stamp(50) }]));

    fixture.componentInstance.recoverHistoryGap();

    expect(fixture.componentInstance.historyGap).toBe(false);
    expect(fixture.componentInstance.messages.map(m => m.id)).toContain('bridge');
    fixture.componentInstance.recoverHistoryGap();
    expect(loadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it('preserva o scroll e cancela auto-scroll pendente ao recuperar páginas', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const component = fixture.componentInstance as any;
    const container = { scrollTop: 140, scrollHeight: 800, clientHeight: 300 };
    vi.spyOn(component, 'getScrollContainer').mockReturnValue(container);
    const cancelScroll = vi.spyOn(component, 'cancelScheduledScroll');
    loadOlderMessages.mockReturnValue(of([{ id: 'bridge', timestamp: stamp(50) }]));

    component.recoverHistoryGap();

    expect(cancelScroll).toHaveBeenCalled();
    expect(container.scrollTop).toBe(140);
    expect(component.messages.map((message: any) => message.id)).toContain('bridge');
  });

  it('compensa deslocamento visual de mensagem após inserir conteúdo de altura variável', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const component = fixture.componentInstance as any;
    let anchorPosition = 180;
    const element = {
      getAttribute: () => 'recent',
      getBoundingClientRect: () => ({ top: anchorPosition, bottom: anchorPosition + 80 }),
    };
    const container = {
      scrollTop: 100,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelectorAll: () => [element],
    };
    vi.spyOn(component, 'getScrollContainer').mockReturnValue(container);
    vi.spyOn(component, 'renderMessages').mockImplementation(() => {
      anchorPosition = 320;
    });
    loadOlderMessages.mockReturnValue(of([{ id: 'bridge', timestamp: stamp(50) }]));

    component.recoverHistoryGap();

    expect(container.scrollTop).toBe(240);
  });

  it('mescla chegada realtime durante recuperação pendente sem duplicar nem perder mensagens', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());

    fixture.componentInstance.recoverHistoryGap();
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'recent', timestamp: stamp(100) },
      { id: 'incoming', timestamp: stamp(101), senderId: 'other-user' },
    ] });
    pending.next([
      { id: 'bridge', timestamp: stamp(50) },
      { id: 'recent', timestamp: stamp(100) },
    ]);
    pending.complete();

    const ids = fixture.componentInstance.messages.map(m => m.id);
    expect(ids).toEqual(['old', 'bridge', 'recent', 'incoming']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('não restaura mensagem excluída do intervalo realtime durante recuperação', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'recent', timestamp: stamp(100) },
      { id: 'removed', timestamp: stamp(101) },
    ] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    pending.next([
      { id: 'bridge', timestamp: stamp(50) },
      { id: 'removed', timestamp: stamp(101) },
    ]);
    pending.complete();

    const ids = fixture.componentInstance.messages.map(m => m.id);
    expect(ids).toContain('bridge');
    expect(ids).not.toContain('removed');
  });

  it('preserva recibo realtime atualizado durante recuperação histórica concorrente', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [
      { id: 'recent', timestamp: stamp(100), status: 'sent' },
    ] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();

    threadState$.next({ chatId: 'c1', messages: [
      { id: 'recent', timestamp: stamp(100), status: 'read' },
      { id: 'incoming', timestamp: stamp(101), status: 'delivered' },
    ] });
    pending.next([
      { id: 'bridge', timestamp: stamp(50), status: 'sent' },
      { id: 'recent', timestamp: stamp(100), status: 'sent' },
    ]);
    pending.complete();

    const messages = fixture.componentInstance.messages;
    expect(messages.find(m => m.id === 'recent')?.status).toBe('read');
    expect(messages.find(m => m.id === 'incoming')?.status).toBe('delivered');
    expect(messages.find(m => m.id === 'bridge')?.status).toBe('sent');
    expect(new Set(messages.map(m => m.id)).size).toBe(messages.length);
  });

  it('descarta página atrasada da conversa anterior após trocar de thread na mesma sessão', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old-a', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent-a', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();
    expect(fixture.componentInstance.loadingGap).toBe(true);

    fixture.componentRef.setInput('chatId', 'c2');
    threadState$.next({ chatId: 'c2', messages: [
      { id: 'message-b', timestamp: stamp(200) },
    ] });
    fixture.detectChanges();

    pending.next([{ id: 'private-a', timestamp: stamp(50) }]);
    pending.complete();
    expect(pending.observed).toBe(false);
    expect(fixture.componentInstance.messages.map(m => m.id)).toEqual(['message-b']);
    expect(fixture.componentInstance.historyGap).toBe(false);
    expect(fixture.componentInstance.loadingGap).toBe(false);
  });

  it('cancela recuperação pendente ao reabrir a mesma conversa', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();
    expect(pending.observed).toBe(true);

    fixture.componentInstance.ngOnChanges({
      chatId: {
        previousValue: 'c1', currentValue: 'c1',
        firstChange: false, isFirstChange: () => false,
      },
    });
    expect(pending.observed).toBe(false);
    pending.next([{ id: 'stale', timestamp: stamp(50) }]);
    expect(fixture.componentInstance.messages.some(m => m.id === 'stale')).toBe(false);
  });

  it('revogação cancela paginação pendente e descarta resposta tardia', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'private', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());

    fixture.componentInstance.loadOlderMessages();
    expect(fixture.componentInstance.loadingOlderMessages).toBe(true);
    expect(pending.observed).toBe(true);

    threadState$.next({ chatId: '', messages: [] });
    expect(pending.observed).toBe(false);
    pending.next([{ id: 'stale-private', timestamp: stamp(50) }]);
    pending.complete();

    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.loadingOlderMessages).toBe(false);
    expect(fixture.componentInstance.historyLoadError).toBe(false);
  });

  it('revogação da thread cancela recuperação pendente e limpa dados privados', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();
    expect(pending.observed).toBe(true);

    threadState$.next({ chatId: '', messages: [] });
    expect(pending.observed).toBe(false);
    pending.next([{ id: 'private', timestamp: stamp(50) }]);
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.historyGap).toBe(false);
    expect(fixture.componentInstance.loadingGap).toBe(false);
  });

  it('cancela recuperação da lacuna ao encerrar sessão', () => {
    const stamp = (seconds: number) => ({ seconds, nanoseconds: 0 });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'old', timestamp: stamp(1) }] });
    threadState$.next({ chatId: 'c1', messages: [{ id: 'recent', timestamp: stamp(100) }] });
    const pending = new Subject<any[]>();
    loadOlderMessages.mockReturnValue(pending.asObservable());
    fixture.componentInstance.recoverHistoryGap();
    uid$.next(null);
    pending.next([{ id: 'secret', timestamp: stamp(50) }]);
    expect(pending.observed).toBe(false);
    expect(fixture.componentInstance.messages).toEqual([]);
    expect(fixture.componentInstance.historyGap).toBe(false);
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
