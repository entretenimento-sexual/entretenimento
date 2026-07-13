// src/app/core/services/batepapo/room-services/room-management.service.ts
// Serviço de comandos de sala. Criação e encerramento passam por Cloud Functions.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  updateDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { serverTimestamp } from 'firebase/firestore';
import { Observable, defer, from, map, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  IRoom,
  IRoomPlaceIntent,
  IRoomPlaceIntentInput,
} from 'src/app/core/interfaces/interfaces-chat/room.interface';
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
  private readonly db = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);

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

    return defer(() =>
      from(this.closePrivateRoomCallable({ roomId: safeRoomId }))
    ).pipe(
      map((result) => result.data),
      catchError((error) => {
        this.reportError(error, 'closeRoom');
        this.notify.showError(this.getCloseRoomUserMessage(error));
        return throwError(() => error);
      })
    );
  }

  /**
   * Compatibilidade temporária. Rules devem bloquear mutações estruturais
   * diretas; a edição definitiva deverá usar callable própria.
   */
  async updateRoom(
    roomId: string,
    roomDetails: Partial<IRoom>
  ): Promise<void> {
    try {
      const safeRoomId = String(roomId ?? '').trim();

      if (!safeRoomId) {
        throw new Error('roomId inválido.');
      }

      const roomRef = doc(this.db, 'rooms', safeRoomId);
      await updateDoc(roomRef, {
        ...roomDetails,
        lastActivity: serverTimestamp(),
      } as any);
    } catch (error) {
      this.reportError(error, 'updateRoom');
      this.notify.showError('Erro ao atualizar sala.');
      throw error;
    }
  }

  /** Compatibilidade temporária; o fluxo seguro é closeRoom(). */
  async deleteRoom(roomId: string): Promise<void> {
    try {
      const safeRoomId = String(roomId ?? '').trim();

      if (!safeRoomId) {
        throw new Error('roomId inválido.');
      }

      const roomRef = doc(this.db, 'rooms', safeRoomId);
      await deleteDoc(roomRef);
    } catch (error) {
      this.reportError(error, 'deleteRoom');
      this.notify.showError('Não foi possível encerrar a sala.');
      throw error;
    }
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
