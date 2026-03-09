// src/app/chat-module/chat-rooms/chat-rooms.component.ts
// Componente responsável por listar salas do usuário e abrir o fluxo de criação.
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica de UID
// - usa CurrentUserStoreService como fonte do perfil do app
// - evita subscribe solto sem teardown
// - centraliza tratamento de erro com GlobalErrorHandlerService + ErrorNotificationService
// - mantém nomenclaturas públicas já usadas no template e em outros componentes
import { Component, DestroyRef, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { combineLatest, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { SubscriptionService } from 'src/app/core/services/subscriptions/subscription.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { InfoCriaSalaBpComponent } from 'src/app/core/textos-globais/info-cria-sala-bp/info-cria-sala-bp.component';
import { RoomCreationConfirmationModalComponent } from '../modals/room-create-confirm-modal/room-creation-confirmation-modal.component';
import { CreateRoomModalComponent } from '../modals/create-room-modal/create-room-modal.component';

@Component({
  selector: 'app-chat-rooms',
  templateUrl: './chat-rooms.component.html',
  styleUrls: ['./chat-rooms.component.css'],
  standalone: false
})
export class ChatRoomsComponent implements OnInit {
  @Output() roomSelected = new EventEmitter<string>();

  chatRooms: any[] = [];
  currentUser: IUserDados | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly subscriptionService: SubscriptionService,
    private readonly roomService: RoomService,
    private readonly roomManagement: RoomManagementService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    public readonly dialog: MatDialog
  ) { }

  ngOnInit(): void {
    /**
     * Fluxo central:
     * - authSession.uid$ = fonte canônica da sessão
     * - currentUserStore.user$ = fonte canônica do perfil do app
     *
     * Regras:
     * - uid null -> limpa estado local
     * - uid válido -> sincroniza currentUser e carrega salas
     */
    combineLatest([
      this.authSession.uid$,
      this.currentUserStore.user$
    ]).pipe(
      map(([uid, user]) => ({
        uid: (uid ?? '').trim() || null,
        user,
      })),
      distinctUntilChanged((a, b) =>
        a.uid === b.uid &&
        (a.user as any)?.uid === (b.user as any)?.uid &&
        (a.user as any)?.role === (b.user as any)?.role &&
        (a.user as any)?.isSubscriber === (b.user as any)?.isSubscriber
      ),
      tap(({ uid, user }) => {
        if (!uid) {
          this.currentUser = null;
          this.chatRooms = [];
          return;
        }

        if (user === null) {
          this.currentUser = null;
          this.chatRooms = [];
          return;
        }

        if (user && user !== undefined) {
          this.currentUser = user as IUserDados;
        }
      }),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.roomService.getUserRooms(uid!).pipe(
          tap((rooms) => {
            this.chatRooms = rooms ?? [];
          }),
          catchError((error) => {
            this.chatRooms = [];
            this.handleError(error, 'Erro ao carregar salas.');
            return of([]);
          })
        )
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /**
   * Seleciona uma sala para interação.
   * Mantém a nomenclatura original.
   */
  selectRoom(roomId: string): void {
    const rid = (roomId ?? '').trim();
    if (!rid) return;

    this.roomSelected.emit(rid);
  }

  /**
   * Abre o modal para criar uma sala.
   *
   * Regras:
   * - sem usuário -> warning
   * - perfil ainda não hidratado (undefined) -> info
   * - limite atingido -> info
   * - usuário sem permissão -> prompt de assinatura
   * - permitido -> abre modal de criação
   */
  openCreateRoomModal(): void {
    const snapshot = this.currentUserStore.getSnapshot();

    if (snapshot === undefined) {
      this.errorNotifier.showInfo('Aguarde o carregamento do seu perfil para criar uma sala.');
      return;
    }

    if (!snapshot?.uid) {
      this.errorNotifier.showWarning('Você precisa estar logado para criar uma sala.');
      return;
    }

    this.currentUser = snapshot;

    const creatorId = snapshot.uid;

    from(this.roomService.countUserRooms(creatorId)).pipe(
      take(1),
      switchMap((roomCount) => {
        const MAX_ROOMS_ALLOWED = 1;

        if (roomCount >= MAX_ROOMS_ALLOWED) {
          this.errorNotifier.showInfo('Você já atingiu o limite de salas criadas.');
          return of(null);
        }

        const canCreateRoom =
          snapshot.isSubscriber === true ||
          ['premium', 'vip'].includes(snapshot.role || '');

        if (!canCreateRoom) {
          this.subscriptionService.promptSubscription({
            title: 'Permissão necessária',
            message: 'Você precisa ser assinante ou ter um perfil premium/vip para criar salas.',
          });
          return of(null);
        }

        const dialogRef = this.dialog.open(CreateRoomModalComponent, {
          width: '60vw',
        });

        return dialogRef.afterClosed().pipe(
          take(1),
          switchMap((result: {
            success?: boolean;
            roomId?: string;
            roomName?: string;
            action?: 'created' | 'updated';
            error?: string;
            roomDetails?: any;
          } | null) => {
            if (!result) return of(null);

            if (result.error) {
              this.errorNotifier.showError(result.error);
              return of(null);
            }

            if (!result.success || !result.roomDetails) {
              return of(null);
            }

            return this.roomManagement.createRoom(result.roomDetails, creatorId).pipe(
              tap((response: any) => {
                if (!response || typeof response !== 'object') return;

                this.openRoomCreationConfirmationModal(
                  response.id ?? response.roomId ?? '',
                  false,
                  roomCount + 1,
                  response.roomName ?? result.roomName ?? 'Sala',
                  (result.action ?? 'created')
                );
              }),
              catchError((error) => {
                this.handleError(error, 'Erro ao criar sala.');
                return of(null);
              })
            );
          })
        );
      }),
      catchError((error) => {
        this.handleError(error, 'Erro ao verificar limite de salas.');
        return of(null);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /**
   * Abre o modal de confirmação após criar/atualizar uma sala.
   */
  private openRoomCreationConfirmationModal(
    roomId: string,
    exceededLimit: boolean,
    roomCount: number,
    roomName: string,
    action: 'created' | 'updated'
  ): void {
    this.dialog.open(RoomCreationConfirmationModalComponent, {
      data: {
        roomId,
        exceededLimit,
        roomCount,
        roomName,
        action,
      },
    });
  }

  /**
   * Abre um modal com informações adicionais sobre a criação de salas.
   */
  openInfoCriaSalaBpModal(event: Event): void {
    event.preventDefault();

    this.dialog.open(InfoCriaSalaBpComponent, {
      width: '50vw',
    });
  }

  /**
   * Tratamento central de erro:
   * - feedback amigável ao usuário
   * - roteamento para o GlobalErrorHandler
   */
  private handleError(error: unknown, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const e = error instanceof Error ? error : new Error(userMessage);
      (e as any).context = 'ChatRoomsComponent';
      (e as any).skipUserNotification = true;
      (e as any).original = error;
      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }
}
