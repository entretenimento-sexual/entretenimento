// src/app/chat-module/chat-list/chat-list.component.ts
// ============================================================================
// CHAT LIST COMPONENT
//
// Responsabilidade atual (fase de transição):
// - exibir lista de chats diretos 1:1
// - exibir lista de rooms
// - emitir seleção de chat/room para o layout pai
// - manter ações de room (editar, excluir, convidar)
// - manter monitor/regras legadas APENAS para room
//
// SUPRESSÕES EXPLÍCITAS NESTA FASE:
// - foi removido o monitor da thread ativa de chat 1:1 deste componente
// - foi removida a lógica de read receipts do chat 1:1 deste componente
// - foi removida a dependência direta do ChatService legado para o eixo 1:1
//
// Motivo:
// - reduzir acoplamento
// - tirar do ChatListComponent a responsabilidade de dono do chat direto
// - preparar a migração para DirectChatFacade / DirectChatService
//
// Observação arquitetural:
// - o 1:1 agora entra via DirectChatFacade
// - rooms permanecem em compat temporária aqui
// - o layout/containers continuam recebendo `chatSelected` como antes
// ============================================================================

import {
  Component,
  DestroyRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
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

type ChatSelection = { id: string; type: 'room' | 'chat' };

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false,
})
export class ChatListComponent implements OnInit, OnDestroy {
  /**
   * Mantidos para compat com o template atual.
   * O ideal futuro é o template consumir somente streams.
   */
  rooms: IRoom[] = [];
  regularChats: IChat[] = [];

  /**
   * Streams públicas do componente.
   */
  rooms$!: Observable<IRoom[]>;
  regularChats$!: Observable<IChat[]>;

  @Output() chatSelected = new EventEmitter<ChatSelection>();

  /**
   * Seleção atual, mantida por compat com CSS/template legado.
   */
  selectedChatId: string | undefined;

  /**
   * UID atual para comparações rápidas locais.
   */
  private currentUserUid: string | null = null;

  /**
   * Monitor legado apenas para rooms.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - chat 1:1 não é mais monitorado aqui
   */
  private readonly activeRoomSelection$ = new Subject<string>();

  /**
   * Anti-spam de writes de read receipts em room.
   */
  private readonly roomReceiptAuditMs = 600;
  private readonly maxRoomReceiptUpdatesPerTick = 50;

  private readonly debug = !environment.production;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    // Auth / acesso
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly access: AccessControlService,

    // Novo eixo 1:1
    private readonly directChatFacade: DirectChatFacade,
    private readonly directChatService: DirectChatService,

    // Eixo room / legado
    private readonly roomService: RoomService,
    private readonly roomMessages: RoomMessagesService,
    private readonly chatnotification: ChatNotificationService,
    private readonly roomManagement: RoomManagementService,
    private readonly inviteService: InviteService,

    // UI
    public readonly dialog: MatDialog,
    private readonly router: Router,

    // Erros centralizados
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.dbg('ChatListComponent init');

    this.bindCurrentUid();
    this.bindAuthFallbackRedirect();
    this.bindRoomsStream();
    this.bindDirectChatsStream();
    this.bindActiveRoomMonitor();
  }

  ngOnDestroy(): void {
    /**
     * Nada manual por enquanto:
     * - takeUntilDestroyed já encerra streams
     * - subject de room não precisa complete imperativo nesta fase
     *
     * Mantido por contrato e por clareza arquitetural.
     */
  }

  // ---------------------------------------------------------------------------
  // Binds
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
            this.router.navigate(['/login'], { replaceUrl: true }).catch(() => {
              // noop
            });
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

        /**
         * Compat atual:
         * - mantém getUserRooms(uid)
         * - quando a arquitetura de group-interactions nascer,
         *   isso deve sair deste componente
         */
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
        this.handleError('ChatList.regularChats$', err, true);
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

  /**
   * Monitor legado apenas de room.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - o monitor de chat 1:1 saiu deste componente
   * - a thread 1:1 deve migrar para DirectThreadFacade / thread container
   */
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
  // Compat helpers para template legado
  // ---------------------------------------------------------------------------

  /**
   * Compat de transição:
   * - o template atual ainda espera `IChat[]`
   * - se faltar otherParticipantDetails, pedimos refresh best-effort
   *
   * Importante:
   * - não bloqueia render
   * - não faz enrichment síncrono
   * - apenas dispara atualização de detalhes via camada nova
   */
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

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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

  isRoom(item: any): boolean {
    return item?.isRoom === true;
  }

  /**
   * Chat 1:1:
   * - seleção local continua por compat
   * - façade nova assume a seleção canônica do eixo direct-chat
   * - este componente não monitora mais a thread do 1:1
   */
  selectChat(chatId: string | undefined): void {
    const safeChatId = (chatId ?? '').trim();
    if (!safeChatId) {
      this.dbg('selectChat: chatId undefined');
      return;
    }

    if (this.selectedChatId === safeChatId) return;

    this.selectedChatId = safeChatId;

    // Novo dono canônico da seleção 1:1
    this.directChatFacade.selectChat(safeChatId);

    // Compat com o restante do módulo atual
    this.chatSelected.emit({ id: safeChatId, type: 'chat' });
  }

  /**
   * Room:
   * - permanece em compat nesta fase
   * - o monitor de room continua aqui temporariamente
   */
  selectRoom(roomId: string | undefined): void {
    const safeRoomId = (roomId ?? '').trim();
    if (!safeRoomId) {
      this.dbg('selectRoom: roomId undefined');
      return;
    }

    if (this.selectedChatId === safeRoomId) return;

    this.selectedChatId = safeRoomId;
    this.chatSelected.emit({ id: safeRoomId, type: 'room' });

    // Legado temporário: room ainda é monitorada aqui
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
    return `${originalURL}&w=40&h=40&fit=crop`;
  }

  // ---------------------------------------------------------------------------
  // Room read receipts (legado temporário)
  // ---------------------------------------------------------------------------

  /**
   * SUPRESSÃO EXPLÍCITA:
   * - este método ficou restrito a ROOM
   * - o branch de read receipts de chat 1:1 foi removido
   *
   * Motivo:
   * - o 1:1 deve sair deste componente
   * - room ainda permanece aqui por compatibilidade temporária
   */
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

  /**
   * Se RoomMessagesService tiver markDeliveredAsRead$, usamos.
   * Se não tiver, fallback com updateMessageStatus por id.
   */
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
  // Sorting helpers
  // ---------------------------------------------------------------------------

  private sortRoomsByActivity(rooms: IRoom[]): IRoom[] {
    return (rooms ?? []).slice().sort((a, b) => {
      const timeA =
        a.lastMessage?.timestamp?.toDate?.().getTime?.() ??
        (a.lastActivity instanceof Date
          ? a.lastActivity.getTime()
          : (a.lastActivity as any)?.toDate?.().getTime?.() ?? 0) ??
        (a.creationTime instanceof Date
          ? a.creationTime.getTime()
          : (a.creationTime as any)?.toDate?.().getTime?.() ?? 0) ??
        0;

      const timeB =
        b.lastMessage?.timestamp?.toDate?.().getTime?.() ??
        (b.lastActivity instanceof Date
          ? b.lastActivity.getTime()
          : (b.lastActivity as any)?.toDate?.().getTime?.() ?? 0) ??
        (b.creationTime instanceof Date
          ? b.creationTime.getTime()
          : (b.creationTime as any)?.toDate?.().getTime?.() ?? 0) ??
        0;

      return timeB - timeA;
    });
  }

  private sortChatsByLastMessage(chats: IChat[]): IChat[] {
    return (chats ?? []).slice().sort((a, b) => {
      const timeA = a.lastMessage?.timestamp
        ? a.lastMessage.timestamp.toDate().getTime()
        : 0;

      const timeB = b.lastMessage?.timestamp
        ? b.lastMessage.timestamp.toDate().getTime()
        : 0;

      return timeB - timeA;
    });
  }

  // ---------------------------------------------------------------------------
  // Debug / Error routing
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
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
