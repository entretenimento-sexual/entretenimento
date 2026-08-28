// src/app/chat-module/chat-rooms/chat-rooms.component.ts
// -----------------------------------------------------------------------------
// CHAT ROOMS COMPONENT
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - renderizar a área "Minhas salas";
// - observar salas em tempo real por participação;
// - separar salas ativas do histórico encerrado;
// - iniciar o fluxo seguro de criação privada;
// - iniciar o fluxo seguro de encerramento da sala própria.
//
// Segurança:
// - a UI oferece orientação, loading e bloqueio visual de limite;
// - a autoridade da criação permanece na callable createPrivateRoom;
// - a autoridade de encerramento permanece na callable closePrivateRoom;
// - não são expostas ações de convite ou mensagens até a migração segura
//   desses fluxos para Functions;
// - local da room é UX premium, mas a autorização real permanece no backend.
//
// Reatividade:
// - a view consome roomsVm$ pelo async pipe;
// - não há atribuição manual de array dentro de tap() para renderização;
// - AuthSessionService continua sendo a fonte canônica de UID.
// -----------------------------------------------------------------------------

import {
  Component,
  DestroyRef,
  EventEmitter,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  EMPTY,
  Observable,
  combineLatest,
  from,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados, UserTierRole } from 'src/app/core/interfaces/iuser-dados';
import {
  IRoom,
  RoomCreationConfirmation,
} from 'src/app/core/interfaces/interfaces-chat/room.interface';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import {
  RoomListItem,
  RoomService,
} from 'src/app/core/services/batepapo/room-services/room.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

import { InfoCriaSalaBpComponent } from 'src/app/core/textos-globais/info-cria-sala-bp/info-cria-sala-bp.component';
import { RoomCreationConfirmationModalComponent } from '../modals/room-create-confirm-modal/room-creation-confirmation-modal.component';
import {
  CreateRoomModalComponent,
  CreateRoomModalResult,
} from '../modals/create-room-modal/create-room-modal.component';

type RoomCardViewModel = RoomListItem & {
  isOwner: boolean;
  canClose: boolean;
};

interface ChatRoomsViewModel {
  uid: string | null;
  rooms: RoomCardViewModel[];
  activeRooms: RoomCardViewModel[];
  closedRooms: RoomCardViewModel[];
  loading: boolean;
  loadFailed: boolean;
  hasOwnedActiveRoom: boolean;
  ownedActiveRoomCount: number;
}

@Component({
  selector: 'app-chat-rooms',
  templateUrl: './chat-rooms.component.html',
  styleUrls: ['./chat-rooms.component.css'],
  standalone: false,
})
export class ChatRoomsComponent implements OnInit {
  @Output() roomSelected = new EventEmitter<string>();

  roomsVm$!: Observable<ChatRoomsViewModel>;

  currentUser: IUserDados | null = null;
  creatingRoom = false;
  closingRoomId: string | null = null;

  private latestVm: ChatRoomsViewModel = {
    uid: null,
    rooms: [],
    activeRooms: [],
    closedRooms: [],
    loading: true,
    loadFailed: false,
    hasOwnedActiveRoom: false,
    ownedActiveRoomCount: 0,
  };

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly roomService: RoomService,
    private readonly roomManagement: RoomManagementService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    public readonly dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.roomsVm$ = combineLatest([
      this.authSession.uid$,
      this.currentUserStore.user$,
    ]).pipe(
      map(([uid, user]) => ({
        uid: String(uid ?? '').trim() || null,
        user,
      })),
      distinctUntilChanged(
        (previous, current) =>
          previous.uid === current.uid &&
          (previous.user as IUserDados | null | undefined)?.uid ===
            (current.user as IUserDados | null | undefined)?.uid &&
          (previous.user as IUserDados | null | undefined)?.profileCompleted ===
            (current.user as IUserDados | null | undefined)?.profileCompleted
      ),
      tap(({ user }) => {
        this.currentUser =
          user && user !== undefined
            ? (user as IUserDados)
            : null;
      }),
      switchMap(({ uid }) => {
        if (!uid) {
          return of(this.buildViewModel(null, [], false, false));
        }

        return this.roomService.getRooms(uid).pipe(
          map((rooms) => this.buildViewModel(uid, rooms, false, false)),
          startWith(this.buildViewModel(uid, [], true, false)),
          catchError((error) => {
            this.handleError(error, 'Erro ao carregar suas salas.');
            return of(this.buildViewModel(uid, [], false, true));
          })
        );
      }),
      tap((viewModel) => {
        this.latestVm = viewModel;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
      takeUntilDestroyed(this.destroyRef)
    );
  }

  /**
   * Método preservado para a futura navegação segura até a conversa da sala.
   *
   * Ele ainda não é exposto no card enquanto mensagens e participação não
   * estiverem validadas sob a nova arquitetura protegida.
   */
  selectRoom(roomId: string): void {
    const id = String(roomId ?? '').trim();

    if (!id) return;
    this.roomSelected.emit(id);
  }

  openCreateRoomModal(): void {
    if (this.creatingRoom) return;

    if (this.latestVm.loading) {
      this.errorNotifier.showInfo('Aguarde enquanto suas salas são carregadas.');
      return;
    }

    if (this.latestVm.hasOwnedActiveRoom) {
      this.errorNotifier.showInfo(
        'Você já possui uma sala ativa criada por você.'
      );
      return;
    }

    const profileSnapshot = this.currentUserStore.getSnapshot();

    if (profileSnapshot === undefined) {
      this.errorNotifier.showInfo(
        'Aguarde o carregamento do seu perfil para criar uma sala.'
      );
      return;
    }

    if (!profileSnapshot) {
      this.errorNotifier.showWarning(
        'Você precisa estar logado para criar uma sala.'
      );
      return;
    }

    from(this.authSession.whenReady())
      .pipe(
        switchMap(() => this.authSession.uid$.pipe(take(1))),
        switchMap((rawUid) => {
          const uid = String(rawUid ?? '').trim();

          if (!uid) {
            this.errorNotifier.showWarning(
              'Você precisa estar logado para criar uma sala.'
            );
            return EMPTY;
          }

          if (profileSnapshot.uid !== uid) {
            this.errorNotifier.showInfo(
              'Seu perfil ainda está sendo sincronizado. Tente novamente.'
            );
            return EMPTY;
          }

          const dialogRef = this.dialog.open(CreateRoomModalComponent, {
            width: 'min(92vw, 40rem)',
            maxWidth: '92vw',
            data: {
              isEditing: false,
              canUsePlaceIntent: this.canUsePlaceIntent(profileSnapshot),
              defaultRegion: {
                uf: profileSnapshot.estado ?? null,
                city: profileSnapshot.municipio ?? null,
              },
            },
          });

          return dialogRef.afterClosed().pipe(
            take(1),
            switchMap((result: CreateRoomModalResult | null) => {
              if (!result?.success || result.action !== 'created') {
                return of(null);
              }

              this.creatingRoom = true;

              return this.roomManagement.createRoom(result.roomDetails).pipe(
                tap((room: IRoom) => {
                  const confirmedRoom: IRoom = {
                    ...room,
                    roomName:
                      String(
                        room.roomName ??
                          result.roomDetails.roomName ??
                          ''
                      ).trim() || 'Sala',
                  };

                  this.openRoomCreationConfirmationModal(
                    confirmedRoom,
                    false,
                    this.latestVm.ownedActiveRoomCount + 1,
                    'created'
                  );
                }),
                finalize(() => {
                  this.creatingRoom = false;
                }),
                catchError(() => of(null))
              );
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  closeRoom(room: RoomCardViewModel): void {
    if (!room.canClose || this.closingRoomId) return;

    const roomId = String(room.id ?? '').trim();

    if (!roomId) {
      this.errorNotifier.showWarning('Sala inválida para encerramento.');
      return;
    }

    const confirmation = this.dialog.open(ConfirmacaoDialogComponent, {
      width: 'min(92vw, 30rem)',
      maxWidth: '92vw',
      autoFocus: 'dialog',
      restoreFocus: true,
      data: {
        title: 'Encerrar sala?',
        message:
          'A conversa ficará indisponível para novas ações. O histórico será preservado e você poderá criar outra sala depois.',
      },
    });

    confirmation.afterClosed().pipe(
      take(1),
      switchMap((confirmed: boolean | undefined) => {
        if (confirmed !== true) return EMPTY;

        this.closingRoomId = roomId;

        return this.roomManagement.closeRoom(roomId).pipe(
          tap(() => {
            this.errorNotifier.showSuccess('Sala encerrada com segurança.');
          }),
          finalize(() => {
            this.closingRoomId = null;
          }),
          catchError(() => of(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  isClosingRoom(roomId: string): boolean {
    return this.closingRoomId === roomId;
  }

  private openRoomCreationConfirmationModal(
    room: IRoom,
    exceededLimit: boolean,
    roomCount: number,
    action: 'created' | 'updated'
  ): void {
    const data: RoomCreationConfirmation = {
      room,
      exceededLimit,
      roomCount,
      action,
    };

    this.dialog.open(RoomCreationConfirmationModalComponent, {
      width: 'min(92vw, 34rem)',
      maxWidth: '92vw',
      data,
    });
  }

  /**
   * Mantido por compatibilidade.
   *
   * O botão não será exibido nesta fase até revisarmos o conteúdo textual do
   * modal, para evitar prometer convite ou participação ainda não liberados.
   */
  openInfoCriaSalaBpModal(event: Event): void {
    event.preventDefault();

    this.dialog.open(InfoCriaSalaBpComponent, {
      width: 'min(92vw, 40rem)',
      maxWidth: '92vw',
    });
  }

  private buildViewModel(
    uid: string | null,
    rooms: RoomListItem[],
    loading: boolean,
    loadFailed: boolean
  ): ChatRoomsViewModel {
    const roomCards: RoomCardViewModel[] = (rooms ?? []).map((room) => ({
      ...room,
      isOwner: !!uid && room.createdBy === uid,
      canClose:
        !!uid &&
        room.createdBy === uid &&
        this.isActiveRoom(room),
    }));
    const activeRooms = roomCards.filter((room) => this.isActiveRoom(room));
    const closedRooms = roomCards.filter((room) => !this.isActiveRoom(room));
    const ownedActiveRoomCount = activeRooms.filter(
      (room) => room.isOwner
    ).length;

    return {
      uid,
      rooms: roomCards,
      activeRooms,
      closedRooms,
      loading,
      loadFailed,
      hasOwnedActiveRoom: ownedActiveRoomCount > 0,
      ownedActiveRoomCount,
    };
  }

  private isActiveRoom(room: Pick<RoomListItem, 'status'>): boolean {
    return room.status !== 'closed' && room.status !== 'archived';
  }

  private canUsePlaceIntent(user: IUserDados): boolean {
    const role = String(user.tier ?? user.role ?? '') as UserTierRole;
    return role === 'premium' || role === 'vip' || role === 'admin';
  }

  private handleError(error: unknown, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(userMessage);

      (normalizedError as any).context = {
        feature: 'chat-rooms',
        operation: 'load-rooms',
      };
      (normalizedError as any).skipUserNotification = true;
      (normalizedError as any).original = error;

      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
