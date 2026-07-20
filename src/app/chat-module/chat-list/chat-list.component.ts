// src/app/chat-module/chat-list/chat-list.component.ts
// ============================================================================
// CHAT LIST COMPONENT
//
// Responsabilidade:
// - exibir a caixa lateral de mensagens;
// - tratar chats diretos e rooms como conversas filtráveis;
// - aplicar busca textual;
// - preservar privacidade com modo discreto de prévias;
// - exibir atividade recente com lastMessageAt;
// - exibir badge de não lidas;
// - emitir seleção segura para o container pai;
// - manter ações de owner para rooms.
//
// Direção de produto:
// - a lista lateral funciona como inbox discreta;
// - não deve expor conteúdo sensível por padrão estrutural;
// - o modo discreto permite ocultar prévias sem quebrar usabilidade;
// - o backend/regras continuam sendo autoridade de segurança.
//
// Supressões explícitas:
// - não há código de spec dentro deste arquivo;
// - não há exposição de payloads sensíveis em console;
// - não há tentativa de atualizar documento pai do chat pela UI;
// - não há criação de nova fonte de dados fora da DirectChatFacade.
// ============================================================================
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';

import {
  BehaviorSubject,
  combineLatest,
  forkJoin,
  Observable,
  of,
  Subject,
} from 'rxjs';
import {
  auditTime,
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
import { Timestamp } from '@firebase/firestore';

import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';

import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { InviteUserModalComponent } from '../modals/invite-user-modal/invite-user-modal.component';
import { CreateRoomModalComponent } from '../modals/create-room-modal/create-room-modal.component';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type ChatSelection = {
  id: string;
  type: 'room' | 'chat';
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
};

type ConversationFilter = 'all' | 'direct' | 'rooms';

type ConversationCollectionState<T> = {
  items: T[];
  loading: boolean;
};

type ChatListViewModel = {
  activeFilter: ConversationFilter;
  searchTerm: string;
  hasSearch: boolean;
  hideMessagePreviews: boolean;

  directCount: number;
  roomsCount: number;
  directUnreadCount: number;

  showDirectChats: boolean;
  showRooms: boolean;

  filteredDirectChats: DirectChatListItem[];
  filteredRooms: IRoom[];

  directChipLabel: string;
  roomsChipLabel: string;

  showLoadingState: boolean;
  shouldShowEmptyState: boolean;
};

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false,
})
export class ChatListComponent implements OnInit, OnDestroy, OnChanges {
  private readonly destroyRef = inject(DestroyRef);

  private roomsSnapshot: IRoom[] = [];

  rooms$!: Observable<IRoom[]>;
  directChatItems$!: Observable<DirectChatListItem[]>;
  vm$!: Observable<ChatListViewModel>;

  @Input() activeChatId: string | undefined;
  @Input() activeType: 'room' | 'chat' | undefined;

  @Output() chatSelected = new EventEmitter<ChatSelection>();

  private readonly activeFilterSubject =
    new BehaviorSubject<ConversationFilter>('all');

  private readonly searchTermSubject =
    new BehaviorSubject<string>('');

  private readonly hideMessagePreviewsSubject =
    new BehaviorSubject<boolean>(this.readStoredBoolean('CHAT_HIDE_MESSAGE_PREVIEWS'));

  private currentUserUid: string | null = null;

  private readonly activeRoomSelection$ = new Subject<string>();

  private readonly roomReceiptAuditMs = 600;
  private readonly maxRoomReceiptUpdatesPerTick = 50;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly access: AccessControlService,

    private readonly directChatFacade: DirectChatFacade,
    private readonly roomService: RoomService,
    private readonly roomMessages: RoomMessagesService,
    private readonly chatnotification: ChatNotificationService,
    private readonly roomManagement: RoomManagementService,
    private readonly inviteService: InviteService,

    public readonly dialog: MatDialog,
    private readonly router: Router,

    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  ngOnInit(): void {
    this.dbg('ChatListComponent init');

    this.bindCurrentUid();
    this.bindAuthFallbackRedirect();
    this.bindRoomsStream();
    this.bindDirectChatsStream();
    this.bindViewModel();
    this.bindActiveRoomMonitor();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeType'] && this.activeType === 'room') {
      this.setActiveFilter('rooms');
    }
  }

  ngOnDestroy(): void {}

  // ---------------------------------------------------------------------------
  // UI actions
  // ---------------------------------------------------------------------------

  setActiveFilter(filter: ConversationFilter): void {
    this.activeFilterSubject.next(filter);
  }

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
    const safeId = (chatId ?? '').trim();

    return (
      this.activeType === 'chat' &&
      !!safeId &&
      this.activeChatId === safeId
    );
  }

  isRoomSelected(roomId: string | undefined): boolean {
    const safeId = (roomId ?? '').trim();

    return (
      this.activeType === 'room' &&
      !!safeId &&
      this.activeChatId === safeId
    );
  }

  selectChat(chat: DirectChatListItem): void {
    const safeChatId = String(chat?.id ?? '').trim();

    if (!safeChatId) {
      this.dbg('selectChat: chatId undefined');
      return;
    }

    if (this.activeType === 'chat' && this.activeChatId === safeChatId) {
      return;
    }

    this.directChatFacade.selectChat(safeChatId);

    this.chatSelected.emit({
      id: safeChatId,
      type: 'chat',
      peerUid: String(chat.otherParticipantUid ?? '').trim() || null,
      peerName: String(chat.otherParticipantNickname ?? '').trim() || null,
      peerPhotoURL: this.extractDirectChatPhotoURL(chat),
    });
  }

  selectRoom(roomId: string | undefined): void {
    const safeRoomId = (roomId ?? '').trim();

    if (!safeRoomId) {
      this.dbg('selectRoom: roomId undefined');
      return;
    }

    if (this.activeType === 'room' && this.activeChatId === safeRoomId) {
      return;
    }

    this.setActiveFilter('rooms');
    this.chatSelected.emit({ id: safeRoomId, type: 'room' });
    this.activeRoomSelection$.next(safeRoomId);
  }

  // ---------------------------------------------------------------------------
  // Direct chat UI helpers
  // ---------------------------------------------------------------------------

  getDirectChatTitle(chat: DirectChatListItem): string {
    return String(chat?.otherParticipantNickname ?? '').trim() || 'Usuário';
  }

  getDirectChatPreview(chat: DirectChatListItem): string {
    const preview = this.getSafePreview(chat?.lastMessagePreview);
    const hidePreviews = this.hideMessagePreviewsSubject.value;

    if (!preview) {
      return 'Nenhuma mensagem recente.';
    }

    if (hidePreviews) {
      if (this.hasUnread(chat)) {
        return 'Nova mensagem';
      }

      if (this.isLastDirectMessageFromMe(chat)) {
        return 'Você enviou uma mensagem';
      }

      return 'Prévia oculta';
    }

    if (this.isLastDirectMessageFromMe(chat)) {
      return `Você: ${preview}`;
    }

    return preview;
  }

  getDirectChatStatusLabel(chat: DirectChatListItem): string {
    if (this.hasUnread(chat)) {
      return `${chat.unreadCount} não lida${chat.unreadCount > 1 ? 's' : ''}`;
    }

    if (this.isLastDirectMessageFromMe(chat)) {
      return 'Enviada por você';
    }

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

  getDirectChatPhotoURL(chat: DirectChatListItem): string {
    const photoURL = this.extractDirectChatPhotoURL(chat);

    return (
      this.getOptimizedPhotoURL(photoURL) ||
      'assets/imagem-padrao.webp'
    );
  }

  getDirectChatActivityEpoch(chat: DirectChatListItem): number | null {
    const epoch = this.coerceEpochMs(chat?.lastMessageAt) ||
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

    if (safeCount > 99) {
      return '99+';
    }

    return String(safeCount);
  }

  private isLastDirectMessageFromMe(chat: DirectChatListItem): boolean {
    const lastMessage = (chat?.chat as any)?.lastMessage ?? {};
    const senderUid = String(
      lastMessage.senderUid ??
      lastMessage.senderId ??
      ''
    ).trim();

    return !!senderUid && !!this.currentUserUid && senderUid === this.currentUserUid;
  }

  private extractDirectChatPhotoURL(chat: DirectChatListItem): string | null {
    return String(chat.otherParticipantPhotoURL ?? '').trim() || null;
  }

  getOptimizedPhotoURL(originalURL: string | null | undefined): string {
    const safeURL = String(originalURL ?? '').trim();

    if (!safeURL) {
      return '';
    }

    const separator = safeURL.includes('?') ? '&' : '?';

    return `${safeURL}${separator}w=52&h=52&fit=crop`;
  }

  // ---------------------------------------------------------------------------
  // Room UI helpers
  // ---------------------------------------------------------------------------

  isOwner(room: IRoom): boolean {
    return !!this.currentUserUid && room?.createdBy === this.currentUserUid;
  }

  getRoomTitle(room: IRoom): string {
    return String(room?.roomName ?? '').trim() || 'Sala';
  }

  getRoomPreview(room: IRoom): string {
    const lastMessagePreview = this.getSafePreview((room as any)?.lastMessage?.content);

    if (lastMessagePreview) {
      return lastMessagePreview;
    }

    return String(room?.description ?? '').trim() || 'Sala ativa para interação em grupo.';
  }

  getRoomActivityEpoch(room: IRoom): number | null {
    const epoch =
      this.coerceEpochMs((room as any)?.lastMessage?.timestamp) ||
      this.coerceEpochMs((room as any)?.lastActivity) ||
      this.coerceEpochMs((room as any)?.creationTime);

    return epoch || null;
  }

  getRoomAriaLabel(room: IRoom): string {
    return `${this.getRoomTitle(room)}. ${this.getRoomPreview(room)}.`;
  }

  sendInvite(roomId: string | undefined, event: MouseEvent): void {
    event.stopPropagation();

    const safeRoomId = (roomId ?? '').trim();

    if (!safeRoomId) {
      this.dbg('sendInvite: roomId undefined');
      return;
    }

    combineLatest([
      this.authSession.uid$.pipe(take(1)),
      this.currentUserStore.user$.pipe(
        filter((u) => u !== undefined),
        take(1)
      ),
    ])
      .pipe(
        switchMap(([uid, appUser]) => {
          if (!uid) {
            this.notifier.showError('Você precisa estar logado para enviar convites.');
            return of(null);
          }

          if (!appUser || !(appUser as any).role) {
            this.notifier.showError('Seu perfil ainda não está pronto para enviar convites.');
            return of(null);
          }

          const dialogRef = this.dialog.open(InviteUserModalComponent, {
            width: '60%',
            maxWidth: '500px',
            data: { roomId: safeRoomId },
          });

          return dialogRef.afterClosed().pipe(
            map((selectedUsers: string[] | null) => ({ uid, selectedUsers }))
          );
        }),
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.handleError('ChatList.sendInvite', err, true);
          return of(null);
        })
      )
      .subscribe((result) => {
        if (!result?.uid || !result.selectedUsers?.length) {
          return;
        }

        const { uid: senderId, selectedUsers } = result;
        const roomName =
          this.roomsSnapshot.find((room) => room.id === safeRoomId)?.roomName ?? '';

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const requests = selectedUsers.map((receiverId) => {
          const invite: Invite = {
            roomId: safeRoomId,
            roomName,
            receiverId,
            senderId,
            status: 'pending',
            sentAt: Timestamp.fromDate(now),
            expiresAt: Timestamp.fromDate(expiresAt),
          };

          return this.inviteService.sendInviteToRoom(safeRoomId, invite).pipe(
            take(1),
            catchError((err) => {
              this.handleError(
                `InviteService.sendInviteToRoom(${receiverId})`,
                err,
                false
              );

              return of(void 0);
            })
          );
        });

        forkJoin(requests)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.dbg('Invites processed', { count: selectedUsers.length });
          });
      });
  }

  deleteRoom(roomId: string | undefined, event: MouseEvent): void {
    event.stopPropagation();

    const safeRoomId = (roomId ?? '').trim();

    if (!safeRoomId) {
      this.dbg('deleteRoom: roomId undefined');
      return;
    }

    const dialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '400px',
      data: {
        title: 'Encerrar Sala',
        message:
          'Tem certeza que deseja encerrar esta Sala? Ela deixará de aceitar novas interações, os participantes perderão o acesso operacional e o histórico será preservado para segurança e auditoria.',
      },
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (!result) {
        return;
      }

      this.roomManagement
        .deleteRoom(safeRoomId)
        .then(() => {
          this.dbg('Sala encerrada', { roomId: safeRoomId });
          this.notifier.showSuccess('Sala encerrada com sucesso.');
        })
        .catch((err) =>
          this.handleError('RoomManagementService.deleteRoom', err, false)
        );
    });
  }

  editRoom(roomId: string, event: MouseEvent): void {
    event.stopPropagation();

    const safeRoomId = (roomId ?? '').trim();

    if (!safeRoomId) {
      this.dbg('editRoom: roomId undefined');
      return;
    }

    const roomData = this.roomsSnapshot.find(
      (room) => room.id === safeRoomId
    );

    if (!roomData) {
      this.dbg('editRoom: sala não encontrada', { roomId: safeRoomId });
      return;
    }

    const dialogRef = this.dialog.open(CreateRoomModalComponent, {
      width: '50%',
      data: { roomId: safeRoomId, roomData, isEditing: true },
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (result?.success) {
        this.dbg('Sala editada', { roomId: safeRoomId });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Streams
  // ---------------------------------------------------------------------------

  private bindCurrentUid(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => (uid ?? '').trim() || null),
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
        filter(([ready]) => !!ready),
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

  private bindRoomsStream(): void {
    this.rooms$ = combineLatest([
      this.access.canRunChatRealtime$,
      this.authSession.uid$,
    ]).pipe(
      switchMap(([canListen, uid]) => {
        if (!canListen || !uid) {
          return of([] as IRoom[]);
        }

        return this.roomService.getRooms(uid);
      }),
      map((rooms) => this.sortRoomsByActivity(rooms)),
      tap((rooms) => {
        this.roomsSnapshot = rooms;
        this.dbg('Rooms loaded', { count: rooms.length });
      }),
      catchError((err) => {
        this.handleError('ChatList.rooms$', err, true);
        this.roomsSnapshot = [];
        return of([] as IRoom[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
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

    const roomsState$ = this.createLoadGate$(
      this.access.canRunChatRealtime$
    ).pipe(
      switchMap((canLoad) => {
        if (!canLoad) {
          return of({
            items: [],
            loading: true,
          } as ConversationCollectionState<IRoom>);
        }

        return this.rooms$.pipe(
          map((items) => ({
            items,
            loading: false,
          })),
          startWith({
            items: [],
            loading: true,
          } as ConversationCollectionState<IRoom>)
        );
      })
    );

    this.vm$ = combineLatest([
      directChatsState$,
      roomsState$,
      this.activeFilterSubject.pipe(distinctUntilChanged()),
      this.searchTermSubject.pipe(distinctUntilChanged()),
      this.hideMessagePreviewsSubject.pipe(distinctUntilChanged()),
    ]).pipe(
      map(([directChatsState, roomsState, activeFilter, searchTerm, hideMessagePreviews]) => {
        const term = this.normalizeText(searchTerm);

        const filteredDirectChats = !term
          ? directChatsState.items
          : directChatsState.items.filter((item) => {
              const nickname = this.normalizeText(item.otherParticipantNickname);

              /**
               * Se o modo discreto estiver ativo, a busca não usa conteúdo da
               * última mensagem. Isso evita inferência por filtro.
               */
              if (hideMessagePreviews) {
                return nickname.includes(term);
              }

              const preview = this.normalizeText(item.lastMessagePreview);
              return nickname.includes(term) || preview.includes(term);
            });

        const filteredRooms = !term
          ? roomsState.items
          : roomsState.items.filter((room) => {
              const roomName = this.normalizeText(room?.roomName);
              const description = this.normalizeText(room?.description);

              return roomName.includes(term) || description.includes(term);
            });

        const showDirectChats =
          activeFilter === 'all' || activeFilter === 'direct';

        const showRooms =
          activeFilter === 'all' || activeFilter === 'rooms';

        const hasVisibleContent =
          (showDirectChats && filteredDirectChats.length > 0) ||
          (showRooms && filteredRooms.length > 0);

        const loading =
          directChatsState.loading || roomsState.loading;

        const directUnreadCount = directChatsState.items.reduce(
          (total, chat) => total + Math.max(0, Number(chat?.unreadCount ?? 0)),
          0
        );

        return {
          activeFilter,
          searchTerm,
          hasSearch: term.length > 0,
          hideMessagePreviews,

          directCount: directChatsState.items.length,
          roomsCount: roomsState.items.length,
          directUnreadCount,

          showDirectChats,
          showRooms,

          filteredDirectChats,
          filteredRooms,

          directChipLabel:
            directUnreadCount > 0
              ? `Diretas ${directUnreadCount > 99 ? '99+' : directUnreadCount}`
              : 'Diretas',

          roomsChipLabel:
            roomsState.items.length > 0
              ? `Salas ${roomsState.items.length}`
              : 'Salas',

          showLoadingState: loading && !hasVisibleContent,
          shouldShowEmptyState: !loading && !hasVisibleContent,
        } satisfies ChatListViewModel;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private createLoadGate$(
    capability$: Observable<boolean>
  ): Observable<boolean> {
    return combineLatest([
      this.authSession.ready$,
      this.authSession.uid$,
      capability$,
    ]).pipe(
      map(([ready, uid, canLoad]) => {
        return (
          ready === true &&
          !!String(uid ?? '').trim() &&
          canLoad === true
        );
      }),
      distinctUntilChanged()
    );
  }

  private bindActiveRoomMonitor(): void {
    this.activeRoomSelection$
      .pipe(
        switchMap((roomId) =>
          combineLatest([this.access.canRunChatRealtime$, this.authSession.uid$]).pipe(
            take(1),
            map(([canListen, uid]) => ({
              roomId,
              canListen,
              uid: (uid ?? '').trim() || null,
            }))
          )
        ),
        switchMap(({ roomId, canListen, uid }) => {
          if (!canListen || !uid) {
            this.dbg('Seleção de room sem permissão/uid', {
              roomId,
              canListen,
              uid,
            });

            return of(void 0);
          }

          return this.roomMessages.getRoomMessages(roomId).pipe(
            auditTime(this.roomReceiptAuditMs),
            switchMap((messages: any[]) =>
              this.applyRoomReadReceipts$(roomId, uid, messages)
            ),
            catchError((err) => {
              this.handleError(`ChatList.activeRoomMonitor(${roomId})`, err, false);
              return of(void 0);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // Room receipts
  // ---------------------------------------------------------------------------

  private applyRoomReadReceipts$(
    roomId: string,
    myUid: string,
    messages: any[]
  ): Observable<void> {
    if (!myUid || !roomId) {
      return of(void 0);
    }

    return this.markRoomDeliveredAsRead$(roomId, myUid, messages).pipe(
      take(1),
      tap((count) => this.decrementUnreadBy(count, this.maxRoomReceiptUpdatesPerTick)),
      map(() => void 0),
      catchError((err) => {
        this.handleError('ChatList.applyRoomReadReceipts$', err, false);
        return of(void 0);
      })
    );
  }

  private markRoomDeliveredAsRead$(
    roomId: string,
    myUid: string,
    messages: any[]
  ): Observable<number> {
    const svc = this.roomMessages as any;

    if (typeof svc.markDeliveredAsRead$ === 'function') {
      return svc.markDeliveredAsRead$(roomId, myUid, messages) as Observable<number>;
    }

    const toMark = (messages ?? [])
      .filter((message: any) => {
        return (
          message?.status === 'delivered' &&
          message?.senderId !== myUid &&
          !!message?.id
        );
      })
      .slice(0, this.maxRoomReceiptUpdatesPerTick);

    if (!toMark.length) {
      return of(0);
    }

    return forkJoin(
      toMark.map((message: any) =>
        this.roomMessages.updateMessageStatus(roomId, message.id, 'read').pipe(
          take(1),
          catchError((err) => {
            this.handleError(
              'RoomMessagesService.updateMessageStatus(read)',
              err,
              false
            );

            return of(void 0);
          })
        )
      )
    ).pipe(
      map(() => toMark.length),
      catchError((err) => {
        this.handleError('ChatList.markRoomDeliveredAsRead$', err, false);
        return of(0);
      })
    );
  }

  private decrementUnreadBy(count: number, cap: number): void {
    const safeCount = Math.max(0, Math.min(count ?? 0, cap));

    for (let i = 0; i < safeCount; i++) {
      this.chatnotification.decrementUnreadMessages();
    }
  }

  // ---------------------------------------------------------------------------
  // Sorting / coercion / privacy helpers
  // ---------------------------------------------------------------------------

  private sortDirectChatsByActivity(items: DirectChatListItem[]): DirectChatListItem[] {
    return (items ?? []).slice().sort((a, b) => {
      const timeA = this.getDirectChatActivityEpoch(a) ?? 0;
      const timeB = this.getDirectChatActivityEpoch(b) ?? 0;

      return timeB - timeA;
    });
  }

  private sortRoomsByActivity(rooms: IRoom[]): IRoom[] {
    return (rooms ?? []).slice().sort((a, b) => {
      const timeA = this.getRoomActivityEpoch(a) ?? 0;
      const timeB = this.getRoomActivityEpoch(b) ?? 0;

      return timeB - timeA;
    });
  }

  private getSafePreview(value: unknown): string {
    const preview = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!preview) {
      return '';
    }

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

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const maybeAny = value as any;

    if (typeof maybeAny?.toDate === 'function') {
      const asDate = maybeAny.toDate();
      return asDate instanceof Date ? asDate.getTime() : 0;
    }

    if (typeof maybeAny?.seconds === 'number') {
      const nanos = typeof maybeAny?.nanoseconds === 'number'
        ? maybeAny.nanoseconds
        : 0;

      return (maybeAny.seconds * 1000) + Math.floor(nanos / 1_000_000);
    }

    if (typeof maybeAny?._seconds === 'number') {
      const nanos = typeof maybeAny?._nanoseconds === 'number'
        ? maybeAny._nanoseconds
        : 0;

      return (maybeAny._seconds * 1000) + Math.floor(nanos / 1_000_000);
    }

    return 0;
  }

  private readStoredBoolean(key: string): boolean {
    try {
      if (typeof localStorage === 'undefined') {
        return false;
      }

      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private storeBoolean(key: string, value: boolean): void {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }

      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // noop
    }
  }

  // ---------------------------------------------------------------------------
  // Error / debug
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatList: ${message}`, extra);
  }

  private handleError(context: string, err: unknown, notifyUser: boolean): void {
    const error =
      err instanceof Error ? err : new Error(`ChatList error: ${context}`);

    (error as any).silent = !notifyUser;
    (error as any).original = err;
    (error as any).context = context;
    (error as any).skipUserNotification = true;

    this.globalError.handleError(error);

    if (notifyUser) {
      this.notifier.showError('Falha ao carregar o chat. Tente novamente.');
    }
  }
} // Linha 1072, fim do ChatListComponent
