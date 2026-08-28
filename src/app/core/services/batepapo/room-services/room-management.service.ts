// src/app/core/services/batepapo/room-services/room-management.service.ts
// Serviço de comandos de sala. Criação e encerramento passam por Cloud Functions.

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

interface CreatePrivateRoomPayload {
  roomName: string;
  description: string | null;
  placeIntent?: IRoomPlaceIntentInput | null;
}

type CreateRoomDetails = Partial<Omit<IRoom, 'placeIntent'>> & {
  placeIntent?: IRoomPlaceIntent | IRoomPlaceIntentInput | null;
};

interface CreatePrivateRoomResponse {
  roomId: string;
  roomName: string;
  description: string | null;
  createdBy: string;
  memberCount: number;
  visibility: 'hidden';
  roomType: 'private';
  status: 'active';
  placeIntent?: IRoomPlaceIntent | null;
}

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

  private readonly createPrivateRoomCallable = httpsCallable<
    CreatePrivateRoomPayload,
    CreatePrivateRoomResponse
  >(this.functions, 'createPrivateRoom');

  private readonly closePrivateRoomCallable = httpsCallable<
    ClosePrivateRoomPayload,
    ClosePrivateRoomResponse
  >(this.functions, 'closePrivateRoom');

  createRoom(
    roomDetails: CreateRoomDetails,
    _legacyCreatorId?: string
  ): Observable<IRoom> {
    void _legacyCreatorId;

    const payload: CreatePrivateRoomPayload = {
      roomName: String(roomDetails.roomName ?? '').trim(),
      description: String(roomDetails.description ?? '').trim() || null,
      placeIntent: this.toPlaceIntentInput(roomDetails.placeIntent),
    };

    return defer(() => from(this.createPrivateRoomCallable(payload))).pipe(
      map((result) => {
        const data = result.data;

        if (!data?.roomId || !data.createdBy) {
          throw new Error('Resposta inválida ao criar sala.');
        }

        return {
          id: data.roomId,
          roomName: data.roomName,
          createdBy: data.createdBy,
          participants: [data.createdBy],
          creationTime: new Date(),
          lastActivity: new Date(),
          description: data.description ?? undefined,
          isPrivate: true,
          roomType: data.roomType,
          visibility: data.visibility,
          placeIntent: data.placeIntent ?? null,
          isRoom: true,
        } as IRoom;
      }),
      catchError((error) => {
        this.reportError(error, 'createRoom');
        this.notify.showError(this.getCreateRoomUserMessage(error));
        return throwError(() => error);
      })
    );
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
   * A edição estrutural direta foi suprimida porque as Rules a bloqueiam e porque
   * ainda não existe uma callable de edição com contrato, auditoria e validação de
   * papel. O método permanece para não quebrar consumidores antigos, mas falha de
   * forma explícita e observável em vez de tentar uma escrita insegura.
   */
  async updateRoom(
    roomId: string,
    _roomDetails: Partial<IRoom>
  ): Promise<void> {
    void _roomDetails;
    const safeRoomId = String(roomId ?? '').trim();
    const error = new Error(
      safeRoomId
        ? 'A edição protegida de sala ainda não está disponível.'
        : 'roomId inválido.'
    );

    this.reportError(error, 'updateRoom');
    this.notify.showInfo('A edição da sala ainda não está disponível.');
    throw error;
  }

  /**
   * Compatibilidade de nomenclatura.
   *
   * “Excluir” uma Sala significa encerrá-la logicamente. O histórico e a auditoria
   * são preservados e o slot do proprietário é liberado pela callable canônica.
   */
  async deleteRoom(roomId: string): Promise<void> {
    await firstValueFrom(this.closeRoom(roomId));
  }

  private toPlaceIntentInput(
    placeIntent: IRoomPlaceIntent | IRoomPlaceIntentInput | null | undefined
  ): IRoomPlaceIntentInput | null {
    if (!placeIntent) {
      return null;
    }

    const venueId = String(placeIntent.venueId ?? '').trim();

    if (!venueId) {
      return null;
    }

    return {
      venueId,
      mode: placeIntent.mode === 'scheduled' ? 'scheduled' : 'now',
      startsAt:
        typeof placeIntent.startsAt === 'number' &&
        Number.isFinite(placeIntent.startsAt)
          ? Math.trunc(placeIntent.startsAt)
          : null,
    };
  }

  private getCreateRoomUserMessage(error: unknown): string {
    const code = this.getErrorCode(error);

    if (code.includes('unauthenticated')) {
      return 'Entre novamente para criar uma sala.';
    }

    if (code.includes('not-found')) {
      return 'O estabelecimento selecionado não está mais disponível.';
    }

    if (code.includes('invalid-argument')) {
      return 'Verifique o nome, a descrição, o estabelecimento e o horário da sala.';
    }

    if (code.includes('permission-denied')) {
      return 'Sua conta ou plano atual não permite criar a sala com essas opções.';
    }

    if (code.includes('failed-precondition')) {
      return 'A sala ou o estabelecimento não está disponível nas condições atuais.';
    }

    return 'Não foi possível criar a sala.';
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

      this.globalError.handleError(normalizedError);
    } catch {
      // Falha de telemetria não deve interromper a operação principal.
    }
  }
}
