// src/app/core/services/batepapo/room-services/room-management.service.ts
// Serviço de compatibilidade de Salas: criação/edição bloqueadas; encerramento via backend.

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  firstValueFrom,
  from,
  map,
  throwError,
} from 'rxjs';
import { catchError, finalize, shareReplay } from 'rxjs/operators';

import {
  IRoom,
  IRoomPlaceIntent,
  IRoomPlaceIntentInput,
} from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { ActionRegistryService } from 'src/app/core/services/action-state/action-registry.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';

type CreateRoomDetails = Partial<Omit<IRoom, 'placeIntent'>> & {
  placeIntent?: IRoomPlaceIntent | IRoomPlaceIntentInput | null;
};

interface ClosePrivateRoomPayload {
  roomId: string;
}

interface ClosePrivateRoomResponse {
  roomId: string;
  status: 'closed';
  slotReleased: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoomManagementService {
  private readonly functions = inject(Functions);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly actionRegistry = inject(ActionRegistryService);
  private readonly closeOperations = new Map<
    string,
    Observable<ClosePrivateRoomResponse>
  >();

  private readonly closePrivateRoomCallable = httpsCallable<
    ClosePrivateRoomPayload,
    ClosePrivateRoomResponse
  >(this.functions, 'closePrivateRoom');

  /**
   * Compatibilidade de API para consumidores antigos.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - a chamada `createPrivateRoom` foi removida do cliente;
   * - nenhuma nova Sala pode ser criada no produto atual;
   * - Comunidades são a superfície coletiva canônica.
   */
  createRoom(
    roomDetails: CreateRoomDetails,
    _legacyCreatorId?: string
  ): Observable<IRoom> {
    void roomDetails;
    void _legacyCreatorId;

    return defer(() => {
      const error = this.createDeprecatedCommandError('createRoom');
      this.reportError(error, 'createRoom');
      this.notify.showInfo(
        'Novas Salas foram descontinuadas. Para interações coletivas, use Comunidades.'
      );
      return throwError(() => error);
    });
  }

  closeRoom(roomId: string): Observable<ClosePrivateRoomResponse> {
    const safeRoomId = String(roomId ?? '').trim();

    if (!safeRoomId) {
      return throwError(() => new Error('roomId inválido.'));
    }

    const activeOperation = this.closeOperations.get(safeRoomId);
    if (activeOperation) return activeOperation;

    const operation$ = this.actionRegistry
      .track$(`room-close:${safeRoomId}`, () =>
        defer(() =>
          from(this.closePrivateRoomCallable({ roomId: safeRoomId }))
        ).pipe(
          map((result) => result.data),
          catchError((error) => {
            this.reportError(error, 'closeRoom');
            this.notify.showError(this.getCloseRoomUserMessage(error));
            return throwError(() => error);
          })
        )
      )
      .pipe(
        finalize(() => this.closeOperations.delete(safeRoomId)),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.closeOperations.set(safeRoomId, operation$);
    return operation$;
  }

  /**
   * Compatibilidade de nomenclatura.
   *
   * SUPRESSÃO EXPLÍCITA: a edição estrutural de Sala permanece bloqueada. As Rules
   * não aceitam essa escrita e o domínio está em compatibilidade somente-leitura,
   * com encerramento como operação de limpeza.
   */
  async updateRoom(
    roomId: string,
    _roomDetails: Partial<IRoom>
  ): Promise<void> {
    void _roomDetails;
    const safeRoomId = String(roomId ?? '').trim();
    const error = safeRoomId
      ? this.createDeprecatedCommandError('updateRoom')
      : new Error('roomId inválido.');

    this.reportError(error, 'updateRoom');
    this.notify.showInfo(
      safeRoomId
        ? 'A edição de Salas foi descontinuada. Use Comunidades para interações coletivas.'
        : 'Sala inválida.'
    );
    throw error;
  }

  /**
   * Compatibilidade de nomenclatura.
   *
   * “Excluir” uma Sala significa encerrá-la logicamente. O histórico e a auditoria
   * são preservados; a callable de encerramento executa a limpeza canônica.
   */
  async deleteRoom(roomId: string): Promise<void> {
    await firstValueFrom(this.closeRoom(roomId));
  }

  private createDeprecatedCommandError(operation: string): Error {
    const error = new Error(
      'Salas estão em modo de compatibilidade e não aceitam novas operações coletivas.'
    );
    (error as any).code = 'failed-precondition';
    (error as any).feature = 'rooms';
    (error as any).operation = operation;
    return error;
  }

  private getCloseRoomUserMessage(error: unknown): string {
    const code = this.getErrorCode(error);

    if (code.includes('unauthenticated')) {
      return 'Entre novamente para encerrar a sala.';
    }

    if (code.includes('permission-denied')) {
      return 'Você não pode encerrar esta sala.';
    }

    if (code.includes('not-found')) {
      return 'Sala não encontrada.';
    }

    if (code.includes('failed-precondition')) {
      return 'Esta sala não pode ser encerrada no estado atual.';
    }

    return 'Não foi possível encerrar a sala.';
  }

  private getErrorCode(error: unknown): string {
    return String((error as { code?: unknown } | null)?.code ?? '').toLowerCase();
  }

  private reportError(error: unknown, operation: string): void {
    try {
      const normalizedError = new Error(
        `[RoomManagementService.${operation}] falhou`
      );

      (normalizedError as any).context = {
        scope: 'RoomManagementService',
        operation,
      };
      (normalizedError as any).original = error;
      (normalizedError as any).skipUserNotification = true;
      (normalizedError as any).silent = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // Falha de telemetria não deve interromper a operação principal.
    }
  }
}
