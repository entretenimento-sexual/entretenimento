// src/app/chat-module/chat-list/chat-list.component.ts
// Responsável por exibir lista de conversas (1:1 e salas), seleção e ações de sala.
//
// Ajustes (estilo grandes plataformas):
// - Fonte de verdade reativa (Observables + shareReplay).
// - Gating de realtime via AccessControlService.canListenRealtime$ (evita listeners sem permissão).
// - Elimina AuthService: usa AuthSessionService (uid/auth), CurrentUserStoreService (perfil/role).
// - Erros roteados para GlobalErrorHandlerService + ErrorNotificationService.
// - “Thread ativa” única: switchMap em seleção cancela monitor anterior automaticamente.
// - Read receipts com auditTime (evita escrita a cada emissão).
//
// Observação importante:
// - Para salas: ideal que RoomMessagesService.getRoomMessages(...) devolva mensagens com `id`.
//   Se ainda estiver retornando só d.data(), read receipts não funcionam (não há messageId).
// - Se você implementou roomMessages.markDeliveredAsRead$ (recomendado), o componente usa.
//   Se não implementou ainda, existe fallback best-effort (menos eficiente).

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

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { InviteUserModalComponent } from '../modals/invite-user-modal/invite-user-modal.component';
import { CreateRoomModalComponent } from '../modals/create-room-modal/create-room-modal.component';

import { Timestamp } from '@firebase/firestore';

// ✅ NOVA ARCH (substitui AuthService)
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

// ✅ Erros centralizados
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
  // Mantido para compat com template atual
  rooms: IRoom[] = [];
  regularChats: IChat[] = [];

  // Streams (recomendado para async pipe se você quiser evoluir o HTML depois)
  rooms$!: Observable<IRoom[]>;
  regularChats$!: Observable<IChat[]>;

  @Output() chatSelected = new EventEmitter<ChatSelection>();
  selectedChatId: string | undefined;

  // UID atual para usos sincrônicos (ex.: isOwner / filtros rápidos)
  private currentUserUid: string | null = null;

  // Seleção reativa da “thread ativa” (como grandes plataformas)
  private readonly activeSelection$ = new Subject<ChatSelection>();

  // Debug controlado
  private readonly debug = !environment.production;

  // Read receipts: debouncer para reduzir writes (especialmente relevante para mobile)
  // TODO(mobile): aumentar para ~800-1200ms e reduzir limites de stream/paginar.
  private readonly readReceiptAuditMs = 600;

  // Segurança operacional: evita loop gigante de decrement em caso de muitos itens
  private readonly maxReceiptUpdatesPerTick = 50;

  // Angular destroy lifecycle (evita leaks)
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    // ✅ NOVA ARCH
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly access: AccessControlService,

    // Services do chat
    private readonly chatService: ChatService,
    private readonly roomService: RoomService,
    private readonly roomMessages: RoomMessagesService,
    private readonly chatnotification: ChatNotificationService,
    private readonly roomManagement: RoomManagementService,
    private readonly inviteService: InviteService,

    // UI
    public readonly dialog: MatDialog,
    private readonly router: Router,

    // ✅ Erros centralizados
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) { }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  ngOnInit(): void {
    this.dbg('ChatListComponent init');

    // UID snapshot (para usos sincrônicos)
    this.authSession.uid$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => (this.currentUserUid = uid));

    // Fallback defensivo: se o componente for acessado sem guard, redireciona após ready.
    combineLatest([this.authSession.ready$, this.authSession.uid$])
      .pipe(
        filter(([ready]) => !!ready),
        take(1),
        tap(([_, uid]) => {
          if (!uid) {
            this.dbg('Sem sessão -> redirect /login (fallback)');
            this.router.navigate(['/login'], { replaceUrl: true }).catch(() => { });
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    // -----------------------------
    // ROOMS (gated realtime)
    // -----------------------------
    this.rooms$ = combineLatest([this.access.canListenRealtime$, this.authSession.uid$]).pipe(
      switchMap(([canListen, uid]) => {
        if (!canListen || !uid) return of([] as IRoom[]);

        // ⚠️ Observação:
        // - Se a UX esperada é “todas as salas em que participo”, use roomService.getRooms(uid).
        // - Se a UX esperada é “somente salas que criei”, use getUserRooms(uid).
        // Aqui mantemos o comportamento atual do seu snippet: getUserRooms(uid).
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

    // Mantém compat com template atual
    this.rooms$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((rooms) => (this.rooms = rooms));

    // -----------------------------
    // CHATS 1:1 (gated realtime + enrichment)
    // -----------------------------
    this.regularChats$ = combineLatest([this.access.canListenRealtime$, this.authSession.uid$]).pipe(
      switchMap(([canListen, uid]) => {
        if (!canListen || !uid) return of([] as IChat[]);
        return this.chatService.getChats(uid);
      }),
      switchMap((chats) => this.enrichChatsWithOtherParticipant$(chats)),
      map((chats) => this.sortChatsByLastMessage(chats)),
      map((chats) => chats.filter((c) => !c.isRoom)),
      tap((chats) => this.dbg('Chats loaded', { count: chats.length })),
      catchError((err) => {
        this.handleError('ChatList.regularChats$', err, true);
        return of([] as IChat[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Mantém compat com template atual
    this.regularChats$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((chats) => (this.regularChats = chats));

    // -----------------------------
    // THREAD ATIVA (monitor único)
    // - switchMap cancela a anterior automaticamente
    // - auditTime reduz writes de read receipts
    // -----------------------------
    this.activeSelection$
      .pipe(
        // Gating por permissão + uid (sem isso: evita listeners indevidos)
        switchMap((sel) =>
          combineLatest([this.access.canListenRealtime$, this.authSession.uid$]).pipe(
            take(1),
            map(([canListen, uid]) => ({ sel, canListen, uid }))
          )
        ),
        switchMap(({ sel, canListen, uid }) => {
          if (!canListen || !uid) {
            // Não “spamma” toast aqui: seleção pode ocorrer por UI,
            // mas sem permissão o app deve simplesmente não abrir realtime.
            this.dbg('Seleção sem permissão/uid - realtime bloqueado', { sel, canListen, uid });
            return of(null as any);
          }

          // Streams do monitor (chat/sala)
          const stream$ =
            sel.type === 'chat'
              ? this.chatService.monitorChat(sel.id)
              : this.roomMessages.getRoomMessages(sel.id);

          // TODO(mobile): reduzir pageSize no monitor e paginar (evita “explodir” memória/render).
          return stream$.pipe(
            auditTime(this.readReceiptAuditMs),
            switchMap((messages: any[]) => this.applyReadReceipts$(sel, uid, messages)),
            catchError((err) => {
              this.handleError(`ChatList.activeMonitor(${sel.type}:${sel.id})`, err, false);
              return of(void 0);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ------------------------------------------------------------
  // Enrichment (dados do outro participante)
  // ------------------------------------------------------------
  /**
   * Em grandes plataformas, a lista sempre renderiza “avatar/nome do outro”.
   * Aqui:
   * - Se o chat já tem otherParticipantDetails -> passa direto.
   * - Se não tem -> chama fetchAndPersistParticipantDetails(...) (one-shot),
   *   que deve persistir/cachar de forma idempotente no nível de service.
   */
  private enrichChatsWithOtherParticipant$(chats: IChat[]): Observable<IChat[]> {
    if (!chats?.length) return of([]);

    const myUid = this.currentUserUid;

    // Se ainda não temos UID (race no boot), não “chuta”:
    // deixa como está e a próxima emissão vai completar.
    if (!myUid) return of(chats);

    const ops = chats.map((chat) => {
      if (chat.otherParticipantDetails) return of(chat);

      const otherUid = (chat.participants ?? []).find((u: string) => u !== myUid);
      if (!otherUid || !chat.id) return of(chat);

      return this.chatService.fetchAndPersistParticipantDetails(chat.id, otherUid).pipe(
        take(1),
        map((details) => ({ ...chat, otherParticipantDetails: details } as IChat)),
        catchError((err) => {
          this.handleError('ChatList.enrichParticipantDetails', err, false);
          return of(chat);
        })
      );
    });

    return combineLatest(ops);
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  sendInvite(roomId: string | undefined, event: MouseEvent): void {
    event.stopPropagation();
    if (!roomId) {
      this.dbg('sendInvite: roomId undefined');
      return;
    }

    // Resolve uid + perfil (role) sem AuthService
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
            data: { roomId },
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

        // ✅ IRoom usa roomName (não name)
        const roomName = this.rooms.find((r) => r.id === roomId)?.roomName ?? '';

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const requests = selectedUsers.map((receiverId) => {
          const invite: Invite = {
            roomId,
            roomName,
            receiverId,
            senderId,
            status: 'pending',
            sentAt: Timestamp.fromDate(now),
            expiresAt: Timestamp.fromDate(expiresAt),
          };

          return this.inviteService.sendInviteToRoom(roomId, invite).pipe(
            take(1),
            catchError((err) => {
              this.handleError(`InviteService.sendInviteToRoom(${receiverId})`, err, false);
              return of(void 0);
            })
          );
        });

        // Dispara em paralelo (melhor UX)
        forkJoin(requests)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => this.dbg('Invites processed', { count: selectedUsers.length }));
      });
  }

  isRoom(item: any): boolean {
    return item?.isRoom === true;
  }

  selectChat(chatId: string | undefined): void {
    if (!chatId) {
      this.dbg('selectChat: chatId undefined');
      return;
    }
    if (this.selectedChatId === chatId) return; // evita re-subscribe/efeitos desnecessários

    this.selectedChatId = chatId;
    this.chatSelected.emit({ id: chatId, type: 'chat' });

    // Atualiza detalhes do participante (best-effort)
    this.chatService.refreshParticipantDetailsIfNeeded(chatId);

    // Ativa monitor “thread ativa”
    this.activeSelection$.next({ id: chatId, type: 'chat' });
  }

  selectRoom(roomId: string | undefined): void {
    if (!roomId) {
      this.dbg('selectRoom: roomId undefined');
      return;
    }
    if (this.selectedChatId === roomId) return;

    this.selectedChatId = roomId;
    this.chatSelected.emit({ id: roomId, type: 'room' });

    // Ativa monitor “thread ativa”
    this.activeSelection$.next({ id: roomId, type: 'room' });
  }

  // Dono da sala (usa UID do AuthSession)
  isOwner(room: IRoom): boolean {
    return !!this.currentUserUid && room?.createdBy === this.currentUserUid;
  }

  deleteRoom(roomId: string | undefined, event: MouseEvent): void {
    event.stopPropagation();
    if (!roomId) {
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
        .deleteRoom(roomId)
        .then(() => this.dbg('Sala excluída', { roomId }))
        .catch((err) => this.handleError('RoomManagementService.deleteRoom', err, true));
    });
  }

  editRoom(roomId: string, event: MouseEvent): void {
    event.stopPropagation();
    const roomData = this.rooms.find((r) => r.id === roomId);
    if (!roomData) {
      this.dbg('editRoom: sala não encontrada', { roomId });
      return;
    }

    const dialogRef = this.dialog.open(CreateRoomModalComponent, {
      width: '50%',
      data: { roomId, roomData, isEditing: true },
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (result?.success) this.dbg('Sala editada', { roomId });
    });
  }

  getOptimizedPhotoURL(originalURL: string | null | undefined): string {
    if (!originalURL) return '';
    // TODO(mobile): considerar fallback/placeholder e compressão via CDN.
    return `${originalURL}&w=40&h=40&fit=crop`;
  }

  // ------------------------------------------------------------
  // Read receipts (delivered -> read) + notificação local
  // ------------------------------------------------------------
  private applyReadReceipts$(sel: ChatSelection, myUid: string, messages: any[]): Observable<void> {
    if (!myUid || !sel?.id) return of(void 0);

    // Proteção: não deixa “tick” virar centenas/milhares de writes
    // (mobile e redes ruins agradecem).
    const cap = this.maxReceiptUpdatesPerTick;

    if (sel.type === 'room') {
      // Preferência: usar helper do service se existir (mais limpo e reutilizável).
      // Se não existir, fallback.
      return this.markRoomDeliveredAsRead$(sel.id, myUid, messages).pipe(
        take(1),
        tap((n) => this.decrementUnreadBy(n, cap)),
        map(() => void 0),
        catchError((err) => {
          this.handleError('ChatList.applyReadReceipts(room)', err, false);
          return of(void 0);
        })
      );
    }

    // Chat 1:1: marca delivered -> read (somente recebidas).
    const toMark = (messages ?? [])
      .filter((m: any) => m?.status === 'delivered' && m.senderId !== myUid && !!m.id)
      .slice(0, cap);

    if (!toMark.length) return of(void 0);

    return forkJoin(
      toMark.map((m: any) =>
        this.chatService.updateMessageStatus(sel.id, m.id, 'read').pipe(
          take(1),
          catchError((err) => {
            this.handleError('ChatService.updateMessageStatus(read)', err, false);
            return of(void 0);
          })
        )
      )
    ).pipe(
      tap(() => this.decrementUnreadBy(toMark.length, cap)),
      map(() => void 0),
      catchError((err) => {
        this.handleError('ChatList.applyReadReceipts(chat)', err, false);
        return of(void 0);
      })
    );
  }

  /**
   * Se RoomMessagesService tiver markDeliveredAsRead$, usamos.
   * Se não tiver, fallback com updateMessageStatus por id (menos eficiente).
   */
  private markRoomDeliveredAsRead$(roomId: string, myUid: string, messages: any[]): Observable<number> {
    const svc: any = this.roomMessages as any;

    if (typeof svc.markDeliveredAsRead$ === 'function') {
      return svc.markDeliveredAsRead$(roomId, myUid, messages) as Observable<number>;
    }

    // Fallback: depende de `messages` conter `id`.
    // Se seu RoomMessagesService ainda retorna só d.data(), isso sempre vai dar 0.
    const toMark = (messages ?? [])
      .filter((m: any) => m?.status === 'delivered' && m.senderId !== myUid && !!m.id)
      .slice(0, this.maxReceiptUpdatesPerTick);

    if (!toMark.length) return of(0);

    return forkJoin(
      toMark.map((m: any) =>
        this.roomMessages.updateMessageStatus(roomId, m.id, 'read').pipe(
          take(1),
          catchError((err) => {
            this.handleError('RoomMessagesService.updateMessageStatus(read)', err, false);
            return of(void 0);
          })
        )
      )
    ).pipe(map(() => toMark.length));
  }

  /**
   * Hoje seu ChatNotificationService parece expor apenas decrementUnreadMessages().
   * Em plataformas grandes, é comum ter:
   * - decrementBy(n) ou recomputar contador via query/aggregation.
   * TODO: evoluir ChatNotificationService para decrementBy(n) (menos loops).
   */
  private decrementUnreadBy(n: number, cap: number): void {
    const safe = Math.max(0, Math.min(n ?? 0, cap));
    for (let i = 0; i < safe; i++) {
      this.chatnotification.decrementUnreadMessages();
    }
  }

  // ------------------------------------------------------------
  // Sorting helpers (mantidos no componente por ora)
  // TODO: migrar para util/helper (p/ reaproveitar e testar isolado).
  // ------------------------------------------------------------
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
      const timeA = a.lastMessage?.timestamp ? a.lastMessage.timestamp.toDate().getTime() : 0;
      const timeB = b.lastMessage?.timestamp ? b.lastMessage.timestamp.toDate().getTime() : 0;
      return timeB - timeA;
    });
  }

  // ------------------------------------------------------------
  // Debug + Error routing
  // ------------------------------------------------------------
  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[ChatList] ${msg}`, extra ?? '');
  }

  /**
   * Roteia erro para o handler global e opcionalmente notifica o usuário.
   * Obs.: evita console.log espalhado e mantém política central.
   */
  private handleError(context: string, err: unknown, notifyUser: boolean): void {
    const e = err instanceof Error ? err : new Error(`ChatList error: ${context}`);
    (e as any).silent = !notifyUser;
    (e as any).original = err;
    (e as any).context = context;

    this.globalError.handleError(e);

    if (notifyUser) {
      this.notifier.showError('Falha ao carregar o chat. Tente novamente.');
    }
  }

  // ------------------------------------------------------------
  // Destroy
  // ------------------------------------------------------------
  ngOnDestroy(): void {
    // Nada manual para “monitor ativo”:
    // - takeUntilDestroyed + switchMap já encerra tudo corretamente.
    // Mantido por contrato (OnDestroy) e para futuras necessidades.
  }
}
