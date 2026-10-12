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
import { Timestamp } from 'firebase/firestore';
import { DateTimeService } from 'src/app/core/services/general/date-time.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';

import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

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
  loadingOlderMessages = false;
  hasMoreHistory = true;
  historyLoadError = false;
  historyGap = false;
  private gapCursor: Message | null = null;
  private gapTarget: Message | null = null;
  private gapRequestSub?: Subscription;
  private gapRequestId = 0;
  loadingGap = false;
  gapLoadError = false;
  private olderMessages: Message[] = [];
  private latestRealtimeMessages: Message[] = [];
  private historyRequestSub?: Subscription;
  private historyRequestId = 0;

  private readonly destroyRef = inject(DestroyRef);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentUserUid: string | null = null;
  private hasObservedInitialSession = false;
  private requiresFreshThreadSelection = false;

  private activeThreadSub?: Subscription;
  private scrollWatchSub?: Subscription;
  private scheduledScrollFrame: number | null = null;
  private scheduledScrollTimeout: ReturnType<typeof setTimeout> | null = null;

  private activeThreadKey = '';
  private forceScrollOnNextRender = false;
  private lastRenderedLastMessageKey = '';

  private readonly nearBottomThresholdPx = 220;

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly roomMessage: RoomMessagesService,
    private readonly applicationError: ApplicationErrorService,
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
      this.requiresFreshThreadSelection = false;
      this.rebindThread();
    }
  }

  ngOnDestroy(): void {
    this.activeThreadSub?.unsubscribe();
    this.activeThreadSub = undefined;
    this.cancelHistoryRequest();
    this.cancelGapRequest();
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
        const nextUid = String(uid ?? '').trim() || null;
        if (this.hasObservedInitialSession && nextUid === this.currentUserUid) return;
        const isInitialSession = !this.hasObservedInitialSession;
        this.hasObservedInitialSession = true;
        this.currentUserUid = nextUid;
        this.activeThreadSub?.unsubscribe();
        this.activeThreadSub = undefined;
        this.cancelHistoryRequest();
        this.cancelGapRequest();
        this.detachScrollWatcher();
        this.resetThreadState();
        // Uma thread escolhida pela sessão anterior nunca pode ser reaberta
        // apenas porque outra conta autenticou, mesmo com o mesmo chatId.
        if (!isInitialSession) {
          this.requiresFreshThreadSelection = true;
          return;
        }
        if (nextUid && this.chatId) {
          this.rebindThread();
        }
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
    this.cancelHistoryRequest();
    this.detachScrollWatcher();

    if (this.requiresFreshThreadSelection || !this.currentUserUid || !safeChatId || (safeType !== 'chat' && safeType !== 'room')) {
      this.resetThreadState();
      return;
    }

    const nextThreadKey = `${safeType}:${safeChatId}`;

    if (this.activeThreadKey !== nextThreadKey) {
      this.activeThreadKey = nextThreadKey;
      this.resetRenderTracking();
      this.forceScrollOnNextRender = true;
      this.pendingIncomingCount = 0;
      this.olderMessages = [];
      this.latestRealtimeMessages = [];
      this.hasMoreHistory = true;
      this.historyLoadError = false;
      this.resetGap();
    }

    const source$ =
      safeType === 'chat'
        ? this.bindDirectChatThread$(safeChatId)
        : this.bindRoomThread$(safeChatId);

    this.activeThreadSub = source$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages) => {
        const incoming = Array.isArray(messages) ? messages : [];
        if (safeType === 'chat') {
          if (!incoming.length) {
            // Um snapshot vazio não é prova de expulsão por limite;
            // nunca retenha mensagens privadas sem uma janela válida.
            this.olderMessages = [];
            this.resetGap();
          } else if (this.latestRealtimeMessages.length) {
            const floor = incoming[0];
            const previousLatest = this.latestRealtimeMessages[this.latestRealtimeMessages.length - 1];
            if (!this.historyGap && this.compareMessages(previousLatest, floor) < 0) {
              this.gapTarget = previousLatest;
              this.gapCursor = floor;
              this.historyGap = true;
              this.gapLoadError = false;
            }
            const currentIds = new Set(incoming.map(message => message.id));
            // Uma mensagem que passou para antes do novo limite inferior
            // continua disponível na leitura local; ausência dentro da
            // janela observada indica remoção ou perda de autorização.
            const evicted = this.latestRealtimeMessages.filter(message =>
              !!message.id && !currentIds.has(message.id) &&
              this.compareMessages(message, floor) < 0
            );
            this.olderMessages = [...evicted, ...this.olderMessages];
          }
          this.latestRealtimeMessages = incoming;
          this.renderMessages(this.combineHistoryAndRealtime());
        } else {
          this.renderMessages(incoming);
        }
        this.attachScrollWatcher();
      });
  }

  private bindDirectChatThread$(chatId: string): Observable<Message[]> {
    this.directChatFacade.selectChat(chatId);

    return this.directThreadFacade.state$.pipe(
      map((state) => {
        if (state.chatId !== chatId) {
          // Acesso revogado ou thread trocada: dados históricos privados
          // também devem desaparecer, não apenas a janela realtime.
          this.cancelHistoryRequest();
          this.olderMessages = [];
          this.latestRealtimeMessages = [];
          this.hasMoreHistory = true;
          this.historyLoadError = false;
          this.resetGap();
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

  /** Carrega mensagens anteriores sem bloquear o listener realtime. */
  loadOlderMessages(): void {
    if (this.type !== 'chat' || !this.chatId || !this.currentUserUid ||
        this.loadingOlderMessages || !this.hasMoreHistory || !this.messages.length) return;

    const oldest = this.messages[0];
    const cursorId = String(oldest?.id ?? '').trim();
    const timestamp = oldest?.timestamp as Timestamp | undefined;
    if (!cursorId || !timestamp || typeof (timestamp as any)?.seconds !== 'number') {
      this.hasMoreHistory = false;
      this.historyLoadError = true;
      this.cdRef.detectChanges();
      return;
    }

    const chatId = this.chatId;
    const sessionUid = this.currentUserUid;
    const requestId = ++this.historyRequestId;
    this.loadingOlderMessages = true;
    this.historyLoadError = false;
    this.historyRequestSub = this.directThreadFacade.loadOlderMessages$(
      chatId, timestamp, cursorId
    ).pipe(take(1)).subscribe({
      next: (page) => {
        if (requestId !== this.historyRequestId || this.chatId !== chatId ||
            this.currentUserUid !== sessionUid || this.activeThreadKey !== `chat:${chatId}`) return;
        const scroll = this.getScrollContainer();
        const oldHeight = scroll?.scrollHeight ?? 0;
        const oldTop = scroll?.scrollTop ?? 0;
        const knownIds = new Set(this.messages.map(message => message.id));
        const unique = (page ?? []).filter(message => !!message.id && !knownIds.has(message.id));
        this.olderMessages = [...unique, ...this.olderMessages];
        this.hasMoreHistory = (page ?? []).length === 20 && unique.length > 0;
        this.loadingOlderMessages = false;
        this.renderMessages(this.combineHistoryAndRealtime(), true);
        if (scroll) scroll.scrollTop = oldTop + (scroll.scrollHeight - oldHeight);
      },
      error: (error) => {
        if (requestId !== this.historyRequestId) return;
        this.loadingOlderMessages = false;
        this.historyLoadError = true;
        this.reportError('Não foi possível carregar mensagens anteriores.', error,
          { op: 'loadOlderMessages', chatId });
        this.cdRef.detectChanges();
      },
      complete: () => {
        if (requestId !== this.historyRequestId) return;
        this.loadingOlderMessages = false;
        this.cdRef.detectChanges();
      },
    });
  }

  /** Recupera apenas uma página da lacuna detectada após reconexão. */
  recoverHistoryGap(): void {
    const cursor = this.gapCursor;
    const target = this.gapTarget;
    const chatId = this.chatId;
    const uid = this.currentUserUid;
    if (!this.historyGap || !cursor || !target || !chatId || !uid ||
        this.loadingGap || this.type !== 'chat') return;

    const request = ++this.gapRequestId;
    this.loadingGap = true;
    this.gapLoadError = false;
    this.gapRequestSub = this.directThreadFacade.loadOlderMessages$(
      chatId, cursor.timestamp as Timestamp, String(cursor.id)
    ).pipe(take(1)).subscribe({
      next: page => {
        if (request !== this.gapRequestId || chatId !== this.chatId ||
            uid !== this.currentUserUid || this.activeThreadKey !== `chat:${chatId}`) return;
        const sorted = [...(page ?? [])].sort((a, b) => this.compareMessages(a, b));
        const recovered = sorted.filter(message => this.compareMessages(message, target) > 0);
        const knownIds = new Set(this.messages.map(message => message.id));
        this.olderMessages = [
          ...recovered.filter(message => !!message.id && !knownIds.has(message.id)),
          ...this.olderMessages,
        ];
        if (sorted.length < 20 || sorted.some(message => this.compareMessages(message, target) <= 0)) {
          this.historyGap = false;
        } else {
          const nextCursor = sorted[0];
          if (this.compareMessages(nextCursor, cursor) >= 0) {
            this.gapLoadError = true;
          } else {
            this.gapCursor = nextCursor;
          }
        }
        this.loadingGap = false;
        this.renderMessages(this.combineHistoryAndRealtime(), true);
      },
      error: error => {
        if (request !== this.gapRequestId) return;
        this.loadingGap = false;
        this.gapLoadError = true;
        this.reportError('Não foi possível recuperar o intervalo de mensagens.', error,
          { op: 'recoverHistoryGap', chatId });
        this.cdRef.detectChanges();
      },
      complete: () => {
        if (request !== this.gapRequestId) return;
        this.loadingGap = false;
        this.cdRef.detectChanges();
      },
    });
  }

  private cancelGapRequest(): void {
    ++this.gapRequestId;
    this.gapRequestSub?.unsubscribe();
    this.gapRequestSub = undefined;
    this.loadingGap = false;
  }

  private resetGap(): void {
    this.cancelGapRequest();
    this.historyGap = false;
    this.gapCursor = null;
    this.gapTarget = null;
    this.gapLoadError = false;
  }

  private compareMessages(a: Message, b: Message): number {
    const left = a.timestamp as Timestamp | undefined;
    const right = b.timestamp as Timestamp | undefined;
    return ((left?.seconds ?? 0) - (right?.seconds ?? 0)) ||
      ((left?.nanoseconds ?? 0) - (right?.nanoseconds ?? 0)) ||
      String(a.id).localeCompare(String(b.id), 'en');
  }

  private combineHistoryAndRealtime(): Message[] {
    const floor = this.latestRealtimeMessages[0];
    const historical = floor
      ? this.olderMessages.filter(message => this.compareMessages(message, floor) < 0)
      : [];
    const messages = new Map<string, Message>();
    for (const message of [...historical, ...this.latestRealtimeMessages]) {
      if (message.id) messages.set(message.id, message);
    }
    return [...messages.values()].sort((a, b) => this.compareMessages(a, b));
  }

  private cancelHistoryRequest(): void {
    ++this.historyRequestId;
    this.historyRequestSub?.unsubscribe();
    this.historyRequestSub = undefined;
    this.loadingOlderMessages = false;
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

  private renderMessages(nextMessages: Message[], historyOnly = false): void {
    const shouldScroll = !historyOnly && this.shouldScrollAfterRender(nextMessages);

    if (!historyOnly) this.updatePendingIncomingCount(nextMessages, shouldScroll);

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
    const previousIds = new Set(this.messages.map(message => message.id));
    const hasNewMessage = nextMessages.some(message => !!message.id && !previousIds.has(message.id));
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
    shouldScroll: boolean
  ): void {
    if (!nextMessages.length) {
      if (shouldScroll || this.isNearBottom()) {
        this.pendingIncomingCount = 0;
      }

      return;
    }

    // Páginas históricas entram antes da janela realtime. Comparar o tamanho
    // ou usar slice(previousCount) classificaria mensagens antigas como novas.
    const previousIds = new Set(this.messages.map(message => message.id));
    const addedMessages = nextMessages.filter(message =>
      !!message.id && !previousIds.has(message.id)
    );
    const previousLast = this.messages[this.messages.length - 1];
    const previousSeconds = (previousLast?.timestamp as Timestamp | undefined)?.seconds ?? -Infinity;
    const previousNanos = (previousLast?.timestamp as Timestamp | undefined)?.nanoseconds ?? 0;
    const incomingCount = addedMessages.filter(message => {
      const stamp = message.timestamp as Timestamp | undefined;
      const seconds = stamp?.seconds ?? -Infinity;
      const nanos = stamp?.nanoseconds ?? 0;
      const isAfterLast = seconds > previousSeconds ||
        (seconds === previousSeconds && (nanos > previousNanos ||
          (nanos === previousNanos && String(message.id) > String(previousLast?.id ?? ''))));
      return isAfterLast && !this.isMessageFromCurrentUser(message);
    }).length;

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
    this.cancelHistoryRequest();
    this.resetGap();
    this.activeThreadKey = '';
    this.olderMessages = [];
    this.latestRealtimeMessages = [];
    this.hasMoreHistory = true;
    this.historyLoadError = false;
    this.messages = [];
    this.threadItems = [];
    this.pendingIncomingCount = 0;
    this.resetRenderTracking();
    this.cancelScheduledScroll();
    this.cdRef.detectChanges();
  }

  private resetRenderTracking(): void {
    this.forceScrollOnNextRender = false;
    this.lastRenderedLastMessageKey = '';
  }

  private storeRenderTracking(messages: Message[]): void {
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
    this.applicationError.report(error, {
      feature: 'direct-chat-thread',
      operation: String(context?.['op'] ?? 'thread'),
      fallbackMessage: userMessage,
      presentation: notifyUser
        ? undefined
        : { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatMessagesListComponent',
        ...(context ?? {}),
      },
    });
  }
}
