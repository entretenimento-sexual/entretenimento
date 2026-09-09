// src/app/chat-module/chat-list/chat-list.component.ts
// ============================================================================
// CHAT LIST COMPONENT — CONVERSAS DIRETAS
//
// Responsabilidade:
// - exibir a caixa lateral de conversas diretas;
// - aplicar busca textual e modo discreto de prévias;
// - exibir atividade recente e badge de não lidas;
// - emitir seleção segura para o container pai.
//
// SUPRESSÃO EXPLÍCITA — depreciação de Salas:
// - removidos listener `rooms$`, filtro `rooms`, seleção de Sala, convites,
//   edição/encerramento dentro da inbox e monitor de mensagens/read receipts;
// - removidas dependências RoomService/RoomMessagesService/RoomManagementService;
// - motivo: Comunidades são o domínio canônico para interação coletiva e a inbox
//   diária não deve manter listeners/custos nem produzir comportamento de Sala.
// - `/chat/rooms` continua separado somente para histórico/encerramento legado.
// ============================================================================
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
  startWith,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type ChatSelection = {
  id: string;
  type: 'chat';
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
};

type ConversationCollectionState<T> = {
  items: T[];
  loading: boolean;
};

type ChatListViewModel = {
  searchTerm: string;
  hasSearch: boolean;
  hideMessagePreviews: boolean;
  directUnreadCount: number;
  filteredDirectChats: DirectChatListItem[];
  showLoadingState: boolean;
  shouldShowEmptyState: boolean;
};

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false,
})
export class ChatListComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  directChatItems$!: Observable<DirectChatListItem[]>;
  vm$!: Observable<ChatListViewModel>;

  @Input() activeChatId: string | undefined;

  /**
   * Mantido temporariamente para compatibilidade do binding do container.
   * A inbox ativa reconhece somente `chat`; `room` não dispara fluxo algum.
   */
  @Input() activeType: 'room' | 'chat' | undefined;

  @Output() chatSelected = new EventEmitter<ChatSelection>();

  private readonly searchTermSubject = new BehaviorSubject<string>('');
  private readonly hideMessagePreviewsSubject = new BehaviorSubject<boolean>(
    this.readStoredBoolean('CHAT_HIDE_MESSAGE_PREVIEWS')
  );

  private currentUserUid: string | null = null;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly access: AccessControlService,
    private readonly directChatFacade: DirectChatFacade,
    private readonly router: Router,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  ngOnInit(): void {
    this.dbg('ChatListComponent init — direct-only');
    this.bindCurrentUid();
    this.bindAuthFallbackRedirect();
    this.bindDirectChatsStream();
    this.bindViewModel();
  }

  ngOnDestroy(): void {}

  setSearchTerm(value: string | null | undefined): void {
    this.searchTermSubject.next(String(value ?? ''));
  }

  clearSearch(): void {
    this.searchTermSubject.next('');
  }

  toggleMessagePreviews(): void {
    const next = !this.hideMessagePreviewsSubject.value;
    this.hideMessagePreviewsSubject.next(next);
    this.storeBoolean('CHAT_HIDE_MESSAGE_PREVIEWS', next);
    this.dbg('toggleMessagePreviews()', { enabled: next });
  }

  isDirectChatSelected(chatId: string | undefined): boolean {
    const safeId = String(chatId ?? '').trim();
    return this.activeType === 'chat' && !!safeId && this.activeChatId === safeId;
  }

  selectChat(chat: DirectChatListItem): void {
    const safeChatId = String(chat?.id ?? '').trim();

    if (!safeChatId) {
      this.dbg('selectChat: chatId undefined');
      return;
    }

    if (this.activeType === 'chat' && this.activeChatId === safeChatId) return;

    this.directChatFacade.selectChat(safeChatId);
    this.chatSelected.emit({
      id: safeChatId,
      type: 'chat',
      peerUid: String(chat.otherParticipantUid ?? '').trim() || null,
      peerName: String(chat.otherParticipantNickname ?? '').trim() || null,
      peerPhotoURL: this.extractDirectChatPhotoURL(chat),
    });
  }

  getDirectChatTitle(chat: DirectChatListItem): string {
    return String(chat?.otherParticipantNickname ?? '').trim() || 'Usuário';
  }

  getDirectChatPreview(chat: DirectChatListItem): string {
    const preview = this.getSafePreview(chat?.lastMessagePreview);
    const hidePreviews = this.hideMessagePreviewsSubject.value;

    if (!preview) return 'Nenhuma mensagem recente.';

    if (hidePreviews) {
      if (this.hasUnread(chat)) return 'Nova mensagem';
      if (this.isLastDirectMessageFromMe(chat)) return 'Você enviou uma mensagem';
      return 'Prévia oculta';
    }

    return this.isLastDirectMessageFromMe(chat) ? `Você: ${preview}` : preview;
  }

  getDirectChatStatusLabel(chat: DirectChatListItem): string {
    if (this.hasUnread(chat)) {
      return `${chat.unreadCount} não lida${chat.unreadCount > 1 ? 's' : ''}`;
    }

    if (this.isLastDirectMessageFromMe(chat)) return 'Enviada por você';
    return 'Conversa direta';
  }

  getDirectChatAriaLabel(chat: DirectChatListItem): string {
    const title = this.getDirectChatTitle(chat);
    const preview = this.getDirectChatPreview(chat);
    const unread = this.hasUnread(chat)
      ? `${chat.unreadCount} mensagens não lidas.`
      : 'Sem mensagens não lidas.';

    return `${title}. ${preview}. ${unread}`;
  }

  getDirectChatActivityEpoch(chat: DirectChatListItem): number | null {
    const epoch =
      this.coerceEpochMs(chat?.lastMessageAt) ||
      this.coerceEpochMs(chat?.chat?.lastMessageAt) ||
      this.coerceEpochMs(chat?.chat?.lastMessage?.timestamp) ||
      this.coerceEpochMs(chat?.chat?.updatedAt);

    return epoch || null;
  }

  hasUnread(chat: DirectChatListItem): boolean {
    return Number(chat?.unreadCount ?? 0) > 0;
  }

  getUnreadLabel(count: number): string {
    const safeCount = Math.max(0, Number(count ?? 0));
    return safeCount > 99 ? '99+' : String(safeCount);
  }

  private isLastDirectMessageFromMe(chat: DirectChatListItem): boolean {
    const lastMessage = (chat?.chat as any)?.lastMessage ?? {};
    const senderUid = String(
      lastMessage.senderUid ?? lastMessage.senderId ?? ''
    ).trim();

    return !!senderUid && !!this.currentUserUid && senderUid === this.currentUserUid;
  }

  private extractDirectChatPhotoURL(chat: DirectChatListItem): string | null {
    return String(chat.otherParticipantPhotoURL ?? '').trim() || null;
  }

  private bindCurrentUid(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => String(uid ?? '').trim() || null),
        distinctUntilChanged(),
        tap((uid) => {
          this.currentUserUid = uid;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindAuthFallbackRedirect(): void {
    combineLatest([this.authSession.ready$, this.authSession.uid$])
      .pipe(
        filter(([ready]) => ready === true),
        take(1),
        tap(([_, uid]) => {
          if (!uid) {
            this.dbg('Sem sessão -> redirect /login (fallback)');
            this.router.navigate(['/login'], { replaceUrl: true }).catch(() => {});
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindDirectChatsStream(): void {
    this.directChatItems$ = this.directChatFacade.items$.pipe(
      tap((items) => this.dbg('Direct chats loaded', { count: items.length })),
      catchError((err) => {
        this.handleError('ChatList.directChatItems$', err, false);
        return of([] as DirectChatListItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private bindViewModel(): void {
    const directChatsState$ = this.createLoadGate$(
      this.access.canListenRealtime$
    ).pipe(
      switchMap((canLoad) => {
        if (!canLoad) {
          return of({
            items: [],
            loading: true,
          } as ConversationCollectionState<DirectChatListItem>);
        }

        return this.directChatItems$.pipe(
          map((items) => ({
            items: this.sortDirectChatsByActivity(items),
            loading: false,
          })),
          startWith({
            items: [],
            loading: true,
          } as ConversationCollectionState<DirectChatListItem>)
        );
      })
    );

    this.vm$ = combineLatest([
      directChatsState$,
      this.searchTermSubject.pipe(distinctUntilChanged()),
      this.hideMessagePreviewsSubject.pipe(distinctUntilChanged()),
    ]).pipe(
      map(([directChatsState, searchTerm, hideMessagePreviews]) => {
        const term = this.normalizeText(searchTerm);
        const filteredDirectChats = !term
          ? directChatsState.items
          : directChatsState.items.filter((item) => {
              const nickname = this.normalizeText(item.otherParticipantNickname);

              if (hideMessagePreviews) return nickname.includes(term);

              const preview = this.normalizeText(item.lastMessagePreview);
              return nickname.includes(term) || preview.includes(term);
            });

        const directUnreadCount = directChatsState.items.reduce(
          (total, chat) => total + Math.max(0, Number(chat?.unreadCount ?? 0)),
          0
        );

        return {
          searchTerm,
          hasSearch: term.length > 0,
          hideMessagePreviews,
          directUnreadCount,
          filteredDirectChats,
          showLoadingState:
            directChatsState.loading && filteredDirectChats.length === 0,
          shouldShowEmptyState:
            !directChatsState.loading && filteredDirectChats.length === 0,
        } satisfies ChatListViewModel;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createLoadGate$(capability$: Observable<boolean>): Observable<boolean> {
    return combineLatest([
      this.authSession.ready$,
      this.authSession.uid$,
      capability$,
    ]).pipe(
      map(
        ([ready, uid, canLoad]) =>
          ready === true && !!String(uid ?? '').trim() && canLoad === true
      ),
      distinctUntilChanged()
    );
  }

  private sortDirectChatsByActivity(
    items: DirectChatListItem[]
  ): DirectChatListItem[] {
    return (items ?? []).slice().sort((a, b) => {
      const timeA = this.getDirectChatActivityEpoch(a) ?? 0;
      const timeB = this.getDirectChatActivityEpoch(b) ?? 0;
      return timeB - timeA;
    });
  }

  private getSafePreview(value: unknown): string {
    const preview = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!preview) return '';
    return preview.length > 140
      ? `${preview.slice(0, 140).trim()}...`
      : preview;
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private coerceEpochMs(value: unknown): number {
    if (!value) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const candidate = value as any;

    if (typeof candidate?.toDate === 'function') {
      const asDate = candidate.toDate();
      return asDate instanceof Date ? asDate.getTime() : 0;
    }

    if (typeof candidate?.seconds === 'number') {
      const nanos = typeof candidate?.nanoseconds === 'number'
        ? candidate.nanoseconds
        : 0;
      return candidate.seconds * 1000 + Math.floor(nanos / 1_000_000);
    }

    if (typeof candidate?._seconds === 'number') {
      const nanos = typeof candidate?._nanoseconds === 'number'
        ? candidate._nanoseconds
        : 0;
      return candidate._seconds * 1000 + Math.floor(nanos / 1_000_000);
    }

    return 0;
  }

  private readStoredBoolean(key: string): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private storeBoolean(key: string, value: boolean): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // noop
    }
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatList: ${message}`, extra);
  }

  private handleError(context: string, err: unknown, notifyUser: boolean): void {
    const error = err instanceof Error ? err : new Error(`ChatList error: ${context}`);
    (error as any).silent = !notifyUser;
    (error as any).original = err;
    (error as any).context = context;
    (error as any).skipUserNotification = true;
    this.globalError.handleError(error);

    if (notifyUser) {
      this.notifier.showError('Falha ao carregar o chat. Tente novamente.');
    }
  }
}
