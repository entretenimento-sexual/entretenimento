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
import { BehaviorSubject, Subject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatInboxState, DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type ChatSelection = {
  id: string;
  type: 'chat';
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
};

type ChatListViewModel = {
  searchTerm: string;
  hasSearch: boolean;
  hideMessagePreviews: boolean;
  directUnreadCount: number;
  filteredDirectChats: DirectChatListItem[];
  showLoadingState: boolean;
  shouldShowEmptyState: boolean;
  loading: boolean;
  hasMore: boolean;
  canRefresh: boolean;
  error: boolean;
  unconfirmedCount: number;
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

  /** A inbox ativa reconhece somente conversa direta. */
  @Input() activeType: 'chat' | undefined;

  @Output() chatSelected = new EventEmitter<ChatSelection>();

  private readonly loadMoreSubject = new Subject<void>();
  private readonly refreshInboxSubject = new Subject<void>();
  private inboxState$!: Observable<DirectChatInboxState>;
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
    private readonly applicationError: ApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  ngOnInit(): void {
    this.dbg('ChatListComponent init — direct-only');
    this.bindCurrentUid();
    this.bindAuthFallbackRedirect();
    this.bindDirectChatsStream();
    this.bindViewModel();
  }

  ngOnDestroy(): void {
    this.loadMoreSubject.complete();
    this.refreshInboxSubject.complete();
  }

  loadMoreConversations(): void { this.loadMoreSubject.next(); }

  refreshConversations(): void { this.refreshInboxSubject.next(); }

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
      this.coerceEpochMs(chat?.chat?.timestamp) ||
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
    const empty: DirectChatInboxState = {
      items: [], status: 'loading', hasMore: false, unconfirmedCount: 0, directUnreadCount: 0,
    };
    this.inboxState$ = this.createLoadGate$(this.access.canListenRealtime$).pipe(
      switchMap(canLoad => canLoad
        ? this.directChatFacade.observeProgressiveInbox$(this.loadMoreSubject, this.refreshInboxSubject)
        : of(empty)),
      catchError(error => {
        this.handleError('ChatList.directChatItems$', error, false);
        return of({ ...empty, status: 'error' as const });
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.directChatItems$ = this.inboxState$.pipe(map(state => state.items));
  }

  private bindViewModel(): void {
    this.vm$ = combineLatest([
      this.inboxState$,
      this.searchTermSubject.pipe(distinctUntilChanged()),
      this.hideMessagePreviewsSubject.pipe(distinctUntilChanged()),
    ]).pipe(
      map(([state, searchTerm, hideMessagePreviews]) => {
        const term = this.normalizeText(searchTerm);
        const filteredDirectChats = !term ? state.items : state.items.filter(item => {
          const nickname = this.normalizeText(item.otherParticipantNickname);
          if (hideMessagePreviews) return nickname.includes(term);
          return nickname.includes(term) || this.normalizeText(item.lastMessagePreview).includes(term);
        });
        const loading = state.status === 'loading' || state.status === 'revoked';
        return {
          searchTerm,
          hasSearch: term.length > 0,
          hideMessagePreviews,
          directUnreadCount: state.directUnreadCount,
          filteredDirectChats,
          loading,
          hasMore: state.hasMore,
          canRefresh: state.status === 'ready' || state.status === 'error',
          error: state.status === 'error',
          unconfirmedCount: state.unconfirmedCount,
          showLoadingState: loading && filteredDirectChats.length === 0,
          shouldShowEmptyState: state.status === 'ready' && !state.hasMore &&
            state.unconfirmedCount === 0 && filteredDirectChats.length === 0,
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
    this.applicationError.report(err, {
      feature: 'chat-list',
      operation: context,
      fallbackMessage: 'Falha ao carregar o chat. Tente novamente.',
      presentation: notifyUser
        ? { surface: 'snackbar', severity: 'error' }
        : { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatListComponent',
        context,
      },
    });
  }
}
