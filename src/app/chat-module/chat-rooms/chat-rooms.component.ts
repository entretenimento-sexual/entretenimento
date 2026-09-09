// src/app/chat-module/chat-rooms/chat-rooms.component.ts
// -----------------------------------------------------------------------------
// CHAT ROOMS COMPONENT — COMPATIBILIDADE LEGADA
// -----------------------------------------------------------------------------
//
// Responsabilidade atual:
// - consultar Salas já existentes do usuário;
// - separar registros ainda ativos do histórico encerrado;
// - permitir ao owner encerrar uma Sala legada com preservação de auditoria.
//
// SUPRESSÃO EXPLÍCITA:
// - removidos criação, confirmação de criação, placeIntent e modal informativo;
// - motivo: Comunidades passam a ser o domínio canônico de interação coletiva e
//   esta tela não pode produzir novas Salas.
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
import { EMPTY, Observable, of } from 'rxjs';
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

import {
  RoomListItem,
  RoomService,
} from 'src/app/core/services/batepapo/room-services/room.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

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
  closingRoomId: string | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly roomService: RoomService,
    private readonly roomManagement: RoomManagementService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    public readonly dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.roomsVm$ = this.authSession.uid$.pipe(
      map((uid) => String(uid ?? '').trim() || null),
      distinctUntilChanged(),
      switchMap((uid) => {
        if (!uid) {
          return of(this.buildViewModel(null, [], false, false));
        }

        return this.roomService.getRooms(uid).pipe(
          map((rooms) => this.buildViewModel(uid, rooms, false, false)),
          startWith(this.buildViewModel(uid, [], true, false)),
          catchError((error) => {
            this.handleError(error, 'Erro ao carregar suas salas antigas.');
            return of(this.buildViewModel(uid, [], false, true));
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
      takeUntilDestroyed(this.destroyRef)
    );
  }

  /** Mantido somente para compatibilidade de binding de consumidores antigos. */
  selectRoom(roomId: string): void {
    const id = String(roomId ?? '').trim();
    if (id) this.roomSelected.emit(id);
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
        title: 'Encerrar sala antiga?',
        message:
          'A Sala será encerrada e permanecerá apenas como histórico. Nenhuma nova participação será criada.',
      },
    });

    confirmation.afterClosed().pipe(
      take(1),
      switchMap((confirmed: boolean | undefined) => {
        if (confirmed !== true) return EMPTY;

        this.closingRoomId = roomId;

        return this.roomManagement.closeRoom(roomId).pipe(
          tap(() => {
            this.errorNotifier.showSuccess('Sala antiga encerrada com segurança.');
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
        !!uid
        && room.createdBy === uid
        && this.isActiveRoom(room),
    }));

    return {
      uid,
      rooms: roomCards,
      activeRooms: roomCards.filter((room) => this.isActiveRoom(room)),
      closedRooms: roomCards.filter((room) => !this.isActiveRoom(room)),
      loading,
      loadFailed,
    };
  }

  private isActiveRoom(room: Pick<RoomListItem, 'status'>): boolean {
    return room.status !== 'closed' && room.status !== 'archived';
  }

  private handleError(error: unknown, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(userMessage);

      (normalizedError as any).context = {
        feature: 'chat-rooms-legacy',
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
