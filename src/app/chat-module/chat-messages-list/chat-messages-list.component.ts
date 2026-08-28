// src/app/chat-module/chat-messages-list/chat-messages-list.component.ts
// ============================================================================
// CHAT MESSAGES LIST COMPONENT
//
// Responsabilidade:
// - renderizar mensagens da thread selecionada;
// - consumir DirectThreadFacade para chat 1:1;
// - manter compat temporária com RoomMessagesService para rooms;
// - manter auto-scroll inteligente;
// - exibir aviso acessível de novas mensagens sem arrancar o usuário do histórico;
// - manter tratamento de erro centralizado;
// - manter debug seguro via PrivacyDebugLoggerService.
//
// SUPRESSÕES EXPLÍCITAS NESTA FASE:
// - não há uso direto de ChatService no eixo 1:1;
// - não há função local markDeliveredMessagesAsRead(...);
// - não há console.log direto;
// - não há exposição de payload sensível de mensagens em debug.
//
// Motivo:
// - receipts do 1:1 pertencem à DirectThreadFacade;
// - a thread 1:1 pertence ao eixo direct-chat;
// - logs precisam respeitar a camada central de privacidade/debug.
// ============================================================================
import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { Observable, Subscription, fromEvent, of } from 'rxjs';
import { catchError, map, switchMap, take, tap, throttleTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { DateTimeService } from 'src/app/core/services/general/date-time.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type ThreadViewItem = {
  kind: 'date-separator' | 'message';
  id: string;
  label?: string;
  message?: Message;
  previousMessage?: Message | null;
  nextMessage?: Message | null;
};

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css'],
  standalone: false,
})
export class ChatMessagesListComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('messagesContainer')
  private messagesContainer?: ElementRef<HTMLDivElement>;

  @Input() chatId: string | undefined;
  @Input() type: 'chat' | 'room' | undefined;

  messages: Message[] = [];
  threadItems: ThreadViewItem[] = [];
  pendingIncomingCount = 0;

  private readonly destroyRef = inject(DestroyRef);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentUserUid: string | null = null;

  private activeThreadSub?: Subscription;
  private scrollWatchSub?: Subscription;
  private scheduledScrollFrame: number | null = null;
  private scheduledScrollTimeout: ReturnType<typeof setTimeout> | null = null;

  private activeThreadKey = '';
  private forceScrollOnNextRender = false;
  private lastRenderedMessageCount = 0;
  private lastRenderedLastMessageKey = '';

  private readonly nearBottomThresholdPx = 220;

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly roomMessage: RoomMessagesService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly authSession: AuthSessionService,
    private readonly dateTime: DateTimeService,
    private readonly cdRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.bindCurrentUserUid();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chatId'] || changes['type']) {
      this.rebindThread();
    }
  }

  ngOnDestroy(): void {
    this.activeThreadSub?.unsubscribe();
    this.activeThreadSub = undefined;
    this.detachScrollWatcher();
    this.cancelScheduledScroll();
  }

  // ---------------------------------------------------------------------------
  // Session binding
  // ---------------------------------------------------------------------------

  private bindCurrentUserUid(): void {
    this.authSession.uid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        this.currentUserUid = String(uid ?? '').trim() || null;
      });
  }

  // ---------------------------------------------------------------------------
  // Thread binding
  // ---------------------------------------------------------------------------

  private rebindThread(): void {
    const safeChatId = (this.chatId ?? '').trim();
    const safeType = this.type ?? null;

    this.activeThreadSub?.unsubscribe();
    this.activeThreadSub = undefined;
    this.detachScrollWatcher();

    if (!safeChatId || (safeType !== 'chat' && safeType !== 'room')) {
      this.resetThreadState();
      return;
    }

    const nextThreadKey = `${safeType}:${safeChatId}`;

    if (this.activeThreadKey !== nextThreadKey) {
      this.activeThreadKey = nextThreadKey;
      this.resetRenderTracking();
      this.forceScrollOnNextRender = true;
      this.pendingIncomingCount = 0;
    }

    const source$ =
      safeType === 'chat'
        ? this.bindDirectChatThread$(safeChatId)
        : this.bindRoomThread$(safeChatId);

    this.activeThreadSub = source$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages) => {
        this.renderMessages(Array.isArray(messages) ? messages : []);
        this.attachScrollWatcher();
      });
  }

  private bindDirectChatThread$(chatId: string): Observable<Message[]> {
    this.directChatFacade.selectChat(chatId);

    return this.directThreadFacade.state$.pipe(
      map((state) => {
        if (state.chatId !== chatId) {
          return [] as Message[];
        }

        return Array.isArray(state.messages) ? state.messages : [];
      }),
      switchMap((messages) => {
        if (!messages.length) {
          return of(messages);
        }

        return this.directThreadFacade.markVisibleMessagesAsRead$(messages).pipe(
          take(1),
          map(() => messages),
          catchError((error) => {
            this.reportError(
              'Falha ao atualizar status das mensagens.',
              error,
              { op: 'bindDirectChatThread.markVisibleMessagesAsRead', chatId },
              false
            );

            return of(messages);
          })
        );
      }),
      tap((messages) => {
        this.dbg('bindDirectChatThread$', {
          chatId,
          count: messages.length,
        });
      }),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar mensagens do chat.',
          error,
          { op: 'bindDirectChatThread', chatId }
        );

        return of([] as Message[]);
      })
    );
  }

  private bindRoomThread$(chatId: string): Observable<Message[]> {
    return this.roomMessage.getRoomMessages(chatId).pipe(
      map((messages) => (Array.isArray(messages) ? messages : [])),
      tap((messages) => {
        this.dbg('bindRoomThread$', {
          roomId: chatId,
          count: messages.length,
        });
      }),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar mensagens da sala.',
          error,
          { op: 'bindRoomThread', chatId }
        );

        return of([] as Message[]);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  getPreviousMessage(index: number): Message | null {
    if (!Number.isInteger(index) || index <= 0) {
      return null;
    }

    return this.messages[index - 1] ?? null;
  }

  getNextMessage(index: number): Message | null {
    if (!Number.isInteger(index) || index < 0) {
      return null;
    }

    return this.messages[index + 1] ?? null;
  }

  scrollToLatestFromNotice(): void {
    this.pendingIncomingCount = 0;
    this.forceScrollOnNextRender = false;
    this.scheduleScrollToBottom();
    this.cdRef.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Render / scroll
  // ---------------------------------------------------------------------------

  private renderMessages(nextMessages: Message[]): void {
    const previousCount = this.lastRenderedMessageCount;
    const shouldScroll = this.shouldScrollAfterRender(nextMessages);

    this.updatePendingIncomingCount(nextMessages, previousCount, shouldScroll);

    this.messages = nextMessages;
    this.threadItems = this.buildThreadItems(nextMessages);
    this.storeRenderTracking(nextMessages);

    this.cdRef.detectChanges();

    if (shouldScroll) {
      this.scheduleScrollToBottom();
    }
  }

  private shouldScrollAfterRender(nextMessages: Message[]): boolean {
    if (this.forceScrollOnNextRender) {
      this.forceScrollOnNextRender = false;
      return true;
    }

    if (!nextMessages.length) {
      return false;
    }

    const nextLastMessageKey = this.getLastMessageKey(nextMessages);
    const hasNewMessage = nextMessages.length > this.lastRenderedMessageCount;
    const lastMessageChanged =
      !!nextLastMessageKey &&
      nextLastMessageKey !== this.lastRenderedLastMessageKey;

    if (!hasNewMessage && !lastMessageChanged) {
      return false;
    }

    const lastMessage = nextMessages[nextMessages.length - 1];

    /**
     * Regra de UX:
     * Se a nova última mensagem foi enviada pelo usuário atual,
     * sempre acompanha a base da conversa.
     *
     * Isso cobre o caso em que a conversa estava rolada para cima
     * artificialmente e o próprio usuário envia uma nova mensagem.
     */
    if (this.isMessageFromCurrentUser(lastMessage)) {
      return true;
    }

    /**
     * Se a mensagem nova veio de outra pessoa, não arrancar o usuário
     * do ponto onde ele está lendo histórico antigo.
     */
    return this.isNearBottom();
  }

  private updatePendingIncomingCount(
    nextMessages: Message[],
    previousCount: number,
    shouldScroll: boolean
  ): void {
    if (!nextMessages.length || nextMessages.length <= previousCount) {
      if (shouldScroll || this.isNearBottom()) {
        this.pendingIncomingCount = 0;
      }

      return;
    }

    const addedMessages = nextMessages.slice(previousCount);
    const incomingCount = addedMessages.filter(
      (message) => !this.isMessageFromCurrentUser(message)
    ).length;

    if (!incomingCount) {
      this.pendingIncomingCount = 0;
      return;
    }

    if (shouldScroll || this.isNearBottom()) {
      this.pendingIncomingCount = 0;
      return;
    }

    this.pendingIncomingCount += incomingCount;
  }

  private isMessageFromCurrentUser(message: Message | null | undefined): boolean {
    if (!message || !this.currentUserUid) {
      return false;
    }

    const senderUid = String(
      message.senderUid ??
      message.senderId ??
      ''
    ).trim();

    return !!senderUid && senderUid === this.currentUserUid;
  }

  private scheduleScrollToBottom(): void {
    this.cancelScheduledScroll();

    if (typeof requestAnimationFrame === 'function') {
      this.scheduledScrollFrame = requestAnimationFrame(() => {
        this.scheduledScrollFrame = null;

        this.scheduledScrollTimeout = setTimeout(() => {
          this.scheduledScrollTimeout = null;
          this.scrollToBottom();
        }, 0);
      });

      return;
    }

    this.scheduledScrollTimeout = setTimeout(() => {
      this.scheduledScrollTimeout = null;
      this.scrollToBottom();
    }, 0);
  }

  private cancelScheduledScroll(): void {
    if (
      this.scheduledScrollFrame !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.scheduledScrollFrame);
    }

    if (this.scheduledScrollTimeout !== null) {
      clearTimeout(this.scheduledScrollTimeout);
    }

    this.scheduledScrollFrame = null;
    this.scheduledScrollTimeout = null;
  }

  private scrollToBottom(): void {
    const container = this.getScrollContainer();

    if (!container) {
      this.dbg('scrollToBottom: scroll container não encontrado');
      return;
    }

    const before = {
      scrollTop: Math.round(container.scrollTop),
      scrollHeight: Math.round(container.scrollHeight),
      clientHeight: Math.round(container.clientHeight),
    };

    container.scrollTop = container.scrollHeight;
    this.pendingIncomingCount = 0;

    const after = {
      scrollTop: Math.round(container.scrollTop),
      scrollHeight: Math.round(container.scrollHeight),
      clientHeight: Math.round(container.clientHeight),
    };

    this.dbg('scrollToBottom', {
      before,
      after,
      moved: after.scrollTop !== before.scrollTop,
    });
  }

  private isNearBottom(): boolean {
    const container = this.getScrollContainer();

    if (!container) {
      return true;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    return distanceFromBottom <= this.nearBottomThresholdPx;
  }

  private attachScrollWatcher(): void {
    if (this.scrollWatchSub || typeof window === 'undefined') {
      return;
    }

    const container = this.getScrollContainer();

    if (!container) {
      return;
    }

    this.scrollWatchSub = fromEvent(container, 'scroll')
      .pipe(
        throttleTime(120, undefined, { leading: true, trailing: true }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        if (this.pendingIncomingCount > 0 && this.isNearBottom()) {
          this.pendingIncomingCount = 0;
          this.cdRef.detectChanges();
        }
      });
  }

  private detachScrollWatcher(): void {
    this.scrollWatchSub?.unsubscribe();
    this.scrollWatchSub = undefined;
  }

  private getScrollContainer(): HTMLElement | null {
    const host = this.hostRef.nativeElement;

    /**
     * O scroll real fica no layout:
     * .chat-shell__thread
     *
     * O #messagesContainer está no thread-shell, que é apenas a estrutura interna.
     */
    const layoutScrollContainer = host.closest(
      '.chat-shell__thread'
    ) as HTMLElement | null;

    if (layoutScrollContainer) {
      return layoutScrollContainer;
    }

    const nearestScrollable = this.findScrollableAncestor(host);

    if (nearestScrollable) {
      return nearestScrollable;
    }

    return this.messagesContainer?.nativeElement ?? null;
  }

  private findScrollableAncestor(start: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = start.parentElement;

    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;

      const canScroll =
        (overflowY === 'auto' || overflowY === 'scroll') &&
        current.scrollHeight > current.clientHeight;

      if (canScroll) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  private resetThreadState(): void {
    this.activeThreadKey = '';
    this.messages = [];
    this.threadItems = [];
    this.pendingIncomingCount = 0;
    this.resetRenderTracking();
    this.cancelScheduledScroll();
    this.cdRef.detectChanges();
  }

  private resetRenderTracking(): void {
    this.forceScrollOnNextRender = false;
    this.lastRenderedMessageCount = 0;
    this.lastRenderedLastMessageKey = '';
  }

  private storeRenderTracking(messages: Message[]): void {
    this.lastRenderedMessageCount = messages.length;
    this.lastRenderedLastMessageKey = this.getLastMessageKey(messages);
  }

  private getLastMessageKey(messages: Message[]): string {
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return '';
    }

    const id = String(lastMessage.id ?? '').trim();

    if (id) {
      return id;
    }

    const senderId = String(lastMessage.senderId ?? lastMessage.senderUid ?? '').trim();
    const content = String(lastMessage.content ?? '').trim();
    const timestamp = this.coerceTimestampKey(lastMessage.timestamp);

    return `${senderId}:${timestamp}:${content}`;
  }

  private coerceTimestampKey(value: unknown): string {
    try {
      const maybeAny = value as any;

      if (typeof maybeAny?.toMillis === 'function') {
        return String(maybeAny.toMillis());
      }

      if (typeof maybeAny?.toDate === 'function') {
        const date = maybeAny.toDate();
        return date instanceof Date ? String(date.getTime()) : '';
      }

      if (value instanceof Date) {
        return String(value.getTime());
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }

      if (typeof value === 'string') {
        return value.trim();
      }

      if (typeof maybeAny?.seconds === 'number') {
        return String(
          maybeAny.seconds * 1000 +
            Math.floor((maybeAny.nanoseconds ?? 0) / 1_000_000)
        );
      }

      if (typeof maybeAny?._seconds === 'number') {
        return String(
          maybeAny._seconds * 1000 +
            Math.floor((maybeAny._nanoseconds ?? 0) / 1_000_000)
        );
      }

      return '';
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Date separators
  // ---------------------------------------------------------------------------

  private buildThreadItems(messages: Message[]): ThreadViewItem[] {
    const items: ThreadViewItem[] = [];

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const previousMessage = messages[index - 1] ?? null;
      const nextMessage = messages[index + 1] ?? null;

      const currentDate = this.getMessageDate(message);
      const previousDate = this.getMessageDate(previousMessage);

      if (currentDate && this.shouldInsertDateSeparator(currentDate, previousDate)) {
        items.push({
          kind: 'date-separator',
          id: `date:${this.getDateKey(currentDate)}`,
          label: this.getDateSeparatorLabel(currentDate),
        });
      }

      items.push({
        kind: 'message',
        id: String(message?.id ?? `message:${index}`),
        message,
        previousMessage,
        nextMessage,
      });
    }

    return items;
  }

  private shouldInsertDateSeparator(
    currentDate: Date,
    previousDate: Date | null
  ): boolean {
    if (!previousDate) {
      return true;
    }

    return !this.isSameLocalDay(currentDate, previousDate);
  }

  private getMessageDate(message: Message | null | undefined): Date | null {
    if (!message?.timestamp) {
      return null;
    }

    try {
      return this.dateTime.convertToDate(message.timestamp as any);
    } catch {
      return null;
    }
  }

  private getDateSeparatorLabel(date: Date): string {
    const today = new Date();

    if (this.isSameLocalDay(date, today)) {
      return 'Hoje';
    }

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (this.isSameLocalDay(date, yesterday)) {
      return 'Ontem';
    }

    const diffDays = Math.floor(
      (this.startOfDay(today).getTime() - this.startOfDay(date).getTime()) /
        86_400_000
    );

    if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString('pt-BR', {
        weekday: 'long',
      });
    }

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private isSameLocalDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  // ---------------------------------------------------------------------------
  // Error / debug
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatMessagesList: ${message}`, extra);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    if (notifyUser) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {}
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);

      (err as any).original = error;
      (err as any).context = {
        scope: 'ChatMessagesListComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      (err as any).silent = !notifyUser;

      this.globalError.handleError(err);
    } catch {}
  }
}
