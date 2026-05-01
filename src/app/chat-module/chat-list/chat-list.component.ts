// src/app/chat-module/chat-list/chat-list.component.ts
// ============================================================================
// CHAT LIST COMPONENT
//
// Responsabilidade atual:
// - exibir lista lateral do módulo de mensagens
// - tratar chats diretos e rooms como itens filtráveis da mesma caixa de entrada
// - aplicar filtro por tipo (all/direct/rooms)
// - aplicar busca textual real sobre diretas e rooms
// - emitir seleção de chat/room para o container pai
// - manter ações de owner para rooms
//
// Ajustes desta versão:
// - adiciona campo de busca real (searchTerm)
// - adiciona listas filtradas por texto
// - mantém "Salas" como chip discreto no topo
//
// SUPRESSÕES EXPLÍCITAS:
// - removida a dependência de blocos explicativos duplicados
// - removida a lógica de seção de rooms sempre exposta como bloco pesado
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
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from 'src/environments/environment';
import { Timestamp } from '@firebase/firestore';

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
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

type ChatSelection = {
  id: string;
  type: 'room' | 'chat';
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
};

type ConversationFilter = 'all' | 'direct' | 'rooms';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false,
})
export class ChatListComponent implements OnInit, OnDestroy, OnChanges {
  rooms: IRoom[] = [];
  regularChats: IChat[] = [];

  rooms$!: Observable<IRoom[]>;
  regularChats$!: Observable<IChat[]>;

  @Input() activeChatId: string | undefined;
  @Input() activeType: 'room' | 'chat' | undefined;

  @Output() chatSelected = new EventEmitter<ChatSelection>();

  /**
   * Filtro ativo da lateral.
   */
  activeFilter: ConversationFilter = 'all';

  /**
   * Busca textual real da lateral.
   */
  searchTerm = '';

  private currentUserUid: string | null = null;

  private readonly activeRoomSelection$ = new Subject<string>();

  private readonly roomReceiptAuditMs = 600;
  private readonly maxRoomReceiptUpdatesPerTick = 50;

  private readonly debug = !environment.production;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly access: AccessControlService,

    private readonly directChatFacade: DirectChatFacade,
    private readonly directChatService: DirectChatService,

    private readonly roomService: RoomService,
    private readonly roomMessages: RoomMessagesService,
    private readonly chatnotification: ChatNotificationService,
    private readonly roomManagement: RoomManagementService,
    private readonly inviteService: InviteService,

    public readonly dialog: MatDialog,
    private readonly router: Router,

    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.dbg('ChatListComponent init');

    this.bindCurrentUid();
    this.bindAuthFallbackRedirect();
    this.bindRoomsStream();
    this.bindDirectChatsStream();
    this.bindActiveRoomMonitor();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeType']) {
      if (this.activeType === 'room') {
        this.activeFilter = 'rooms';
      }
    }
  }

  ngOnDestroy(): void {}

  setActiveFilter(filter: ConversationFilter): void {
    this.activeFilter = filter;
  }

  clearSearch(): void {
    this.searchTerm = '';
  }

  get hasSearch(): boolean {
    return this.normalizeText(this.searchTerm).length > 0;
  }

  get showDirectChats(): boolean {
    return this.activeFilter === 'all' || this.activeFilter === 'direct';
  }

  get showRooms(): boolean {
    return this.activeFilter === 'all' || this.activeFilter === 'rooms';
  }

  get roomsChipLabel(): string {
    const count = this.filteredRooms.length;
    return count > 0 ? `Salas ${count}` : 'Salas';
  }

  get filteredDirectChats(): IChat[] {
    const term = this.normalizeText(this.searchTerm);
    const source = this.regularChats ?? [];

    if (!term) {
      return source;
    }

    return source.filter((chat) => {
      const nickname = this.normalizeText((chat as any)?.otherParticipantDetails?.nickname);
      const preview = this.normalizeText(chat?.lastMessage?.content);
      return nickname.includes(term) || preview.includes(term);
    });
  }

  get filteredRooms(): IRoom[] {
    const term = this.normalizeText(this.searchTerm);
    const source = this.rooms ?? [];

    if (!term) {
      return source;
    }

    return source.filter((room) => {
      const roomName = this.normalizeText(room?.roomName);
      const description = this.normalizeText(room?.description);
      return roomName.includes(term) || description.includes(term);
    });
  }

  get hasVisibleDirectChats(): boolean {
    return this.filteredDirectChats.length > 0;
  }

  get hasVisibleRooms(): boolean {
    return this.filteredRooms.length > 0;
  }

  get shouldShowEmptyState(): boolean {
    const noDirectWhenExpected = this.showDirectChats && !this.hasVisibleDirectChats && !this.showRooms;
    const noRoomsWhenExpected = this.showRooms && !this.hasVisibleRooms && !this.showDirectChats;
    const noAnything = !this.hasVisibleDirectChats && !this.hasVisibleRooms;
    return noDirectWhenExpected || noRoomsWhenExpected || noAnything;
  }

  isDirectChatSelected(chatId: string | undefined): boolean {
    const safeId = (chatId ?? '').trim();
    return this.activeType === 'chat' && !!safeId && this.activeChatId === safeId;
  }

  isRoomSelected(roomId: string | undefined): boolean {
    const safeId = (roomId ?? '').trim();
    return this.activeType === 'room' && !!safeId && this.activeChatId === safeId;
  }

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

        return this.roomService.getUserRooms(uid);
      }),
      map((rooms) => this.sortRoomsByActivity(rooms)),
      tap((rooms) => this.dbg('Rooms loaded', { count: rooms.length })),
      catchError((err) => {
        this.handleError('ChatList.rooms$', err, true);
        return of([] as IRoom[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.rooms$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rooms) => {
        this.rooms = rooms;
      });
  }

  private bindDirectChatsStream(): void {
    this.regularChats$ = this.directChatFacade.items$.pipe(
      switchMap((items) => this.enrichDirectChatsForLegacyTemplate$(items)),
      map((chats) => this.sortChatsByLastMessage(chats)),
      tap((chats) => this.dbg('Direct chats loaded', { count: chats.length })),
      catchError((err) => {
        this.handleError('ChatList.regularChats$', err, false);
        return of([] as IChat[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.regularChats$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((chats) => {
        this.regularChats = chats;
      });
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

  private enrichDirectChatsForLegacyTemplate$(
    items: DirectChatListItem[]
  ): Observable<IChat[]> {
    const chats = (items ?? []).map((item) => item.chat);

    for (const chat of chats) {
      if (!chat?.id) continue;

      if (!(chat as any)?.otherParticipantDetails) {
        this.directChatService.refreshParticipantDetailsIfNeeded(chat.id);
      }
    }

    return of(chats);
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
        if (!result?.uid || !result.selectedUsers?.length) return;

        const { uid: senderId, selectedUsers } = result;
        const roomName =
          this.rooms.find((room) => room.id === safeRoomId)?.roomName ?? '';

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

  selectChat(chat: IChat): void {
    const safeChatId = (chat?.id ?? '').trim();
    if (!safeChatId) {
      this.dbg('selectChat: chatId undefined');
      return;
    }

    if (this.activeType === 'chat' && this.activeChatId === safeChatId) {
      return;
    }

    this.directChatFacade.selectChat(safeChatId);

    const peer = (chat as any)?.otherParticipantDetails;

    this.chatSelected.emit({
      id: safeChatId,
      type: 'chat',
      peerUid: (peer?.uid ?? '').trim() || null,
      peerName: (peer?.nickname ?? '').trim() || null,
      peerPhotoURL: (peer?.photoURL ?? '').trim() || null,
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

    this.activeFilter = 'rooms';
    this.chatSelected.emit({ id: safeRoomId, type: 'room' });
    this.activeRoomSelection$.next(safeRoomId);
  }

  isOwner(room: IRoom): boolean {
    return !!this.currentUserUid && room?.createdBy === this.currentUserUid;
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
        title: 'Confirmar Exclusão',
        message:
          'Tem certeza que deseja excluir esta sala? Esta ação irá remover permanentemente a sala, todos os perfis adicionados e todas as mensagens trocadas.',
      },
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (!result) return;

      this.roomManagement
        .deleteRoom(safeRoomId)
        .then(() => this.dbg('Sala excluída', { roomId: safeRoomId }))
        .catch((err) => this.handleError('RoomManagementService.deleteRoom', err, true));
    });
  }

  editRoom(roomId: string, event: MouseEvent): void {
    event.stopPropagation();

    const safeRoomId = (roomId ?? '').trim();
    if (!safeRoomId) {
      this.dbg('editRoom: roomId undefined');
      return;
    }

    const roomData = this.rooms.find((room) => room.id === safeRoomId);
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

  getOptimizedPhotoURL(originalURL: string | null | undefined): string {
    if (!originalURL) return '';
    return `${originalURL}&w=52&h=52&fit=crop`;
  }

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
      const nanos = typeof maybeAny?.nanoseconds === 'number' ? maybeAny.nanoseconds : 0;
      return (maybeAny.seconds * 1000) + Math.floor(nanos / 1_000_000);
    }

    if (typeof maybeAny?._seconds === 'number') {
      const nanos = typeof maybeAny?._nanoseconds === 'number' ? maybeAny._nanoseconds : 0;
      return (maybeAny._seconds * 1000) + Math.floor(nanos / 1_000_000);
    }

    return 0;
  }

  private sortRoomsByActivity(rooms: IRoom[]): IRoom[] {
    return (rooms ?? []).slice().sort((a, b) => {
      const timeA =
        this.coerceEpochMs(a?.lastMessage?.timestamp) ||
        this.coerceEpochMs(a?.lastActivity) ||
        this.coerceEpochMs(a?.creationTime);

      const timeB =
        this.coerceEpochMs(b?.lastMessage?.timestamp) ||
        this.coerceEpochMs(b?.lastActivity) ||
        this.coerceEpochMs(b?.creationTime);

      return timeB - timeA;
    });
  }

  private sortChatsByLastMessage(chats: IChat[]): IChat[] {
    return (chats ?? []).slice().sort((a, b) => {
      const timeA = this.coerceEpochMs(a?.lastMessage?.timestamp);
      const timeB = this.coerceEpochMs(b?.lastMessage?.timestamp);

      return timeB - timeA;
    });
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    console.log(`[ChatList] ${message}`, extra ?? '');
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
}