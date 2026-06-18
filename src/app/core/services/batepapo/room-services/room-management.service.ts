// src/app/core/services/batepapo/room-services/room-management.service.ts
// -----------------------------------------------------------------------------
// ROOM MANAGEMENT SERVICE
// -----------------------------------------------------------------------------
//
// Responsabilidade atual:
// - solicitar criação segura de sala privada via Cloud Function;
// - solicitar encerramento seguro de sala privada via Cloud Function;
// - manter, temporariamente, assinaturas legadas de update/delete para não
//   romper consumidores ainda existentes.
//
// Segurança:
// - createRoom() e closeRoom() não gravam diretamente no Firestore;
// - creatorId recebido por consumidores legados não é enviado ao backend;
// - o UID real é obtido exclusivamente pelas callables em request.auth.uid;
// - participants, visibility, status e regras de plano são definidos no backend;
// - placeIntent é opcional e validado novamente pelo backend.
//
// Migração pendente:
// - updateRoom() e deleteRoom() ainda são métodos legados;
// - as Rules passam a bloquear mutações estruturais diretas;
// - edição deverá ganhar callable própria.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  updateDoc,
} from '@angular/fire/firestore';
import {
  Functions,
  httpsCallable,
} from '@angular/fire/functions';
import { serverTimestamp } from 'firebase/firestore';
import {
  Observable,
  defer,
  from,
  map,
  throwError,
} from 'rxjs';
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

  /**
   * Cria uma sala privada por backend confiável.
   *
   * O segundo parâmetro permanece opcional somente por compatibilidade com
   * consumidores legados ainda existentes, como RoomEffects. Ele não é
   * utilizado como identidade nem enviado à Function.
   */
  createRoom(
    roomDetails: CreateRoomDetails,
    _legacyCreatorId?: string
  ): Observable<IRoom> {
    void _legacyCreatorId;

    const payload: CreatePrivateRoomPayload = {
      roomName: String(roomDetails.roomName ?? '').trim(),
      description: String(roomDetails.description ?? '').trim() || null,
      placeIntent: roomDetails.placeIntent
        ? {
            mode: roomDetails.placeIntent.mode,
            visibility: roomDetails.placeIntent.visibility,
            region: roomDetails.placeIntent.region,
            label: roomDetails.placeIntent.label,
            startsAt: roomDetails.placeIntent.startsAt,
            endsAt: roomDetails.placeIntent.endsAt ?? null,
          }
        : null,
    };

    return defer(() =>
      from(this.createPrivateRoomCallable(payload))
    ).pipe(
      map((result) => {
        const data = result.data;

        if (!data?.roomId || !data.createdBy) {
          throw new Error('Resposta inválida ao criar sala.');
        }

        /**
         * Projeção imediata para a UI.
         *
         * `creationTime` e `lastActivity` canônicos permanecem gravados pelo
         * backend com serverTimestamp(). O listener do RoomService atualizará
         * a lista com os timestamps reais do Firestore.
         */
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

  /**
   * Encerra logicamente uma sala privada pelo backend.
   *
   * Não apaga documento, não altera status pelo cliente e libera o slot do
   * owner apenas quando a callable confirma a operação.
   */
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
   * Método legado mantido apenas para preservar consumidores atuais.
   *
   * Após a atualização das Rules abaixo, alterações diretas estruturais serão
   * negadas. A edição segura deverá ser implementada posteriormente por uma
   * callable específica, sem permitir alteração cliente-side de participantes,
   * visibilidade ou status.
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

  /**
   * Método legado mantido para compatibilidade.
   *
   * A exclusão direta já deve permanecer bloqueada por Rules. A evolução
   * correta é closeRoom(), com fechamento lógico e auditoria.
   */
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

  private getCreateRoomUserMessage(error: unknown): string {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).toLowerCase();

    if (code.includes('unauthenticated')) {
      return 'Entre novamente para criar uma sala.';
    }

    if (code.includes('invalid-argument')) {
      return 'Verifique o nome, a descrição e o local da sala.';
    }

    if (code.includes('permission-denied')) {
      return 'Sua conta ou plano atual não permite criar salas com essas opções.';
    }

    if (code.includes('failed-precondition')) {
      return 'Não foi possível criar a sala nas condições atuais da sua conta.';
    }

    return 'Não foi possível criar a sala.';
  }

  private getCloseRoomUserMessage(error: unknown): string {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).toLowerCase();

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
      // noop
    }
  }
}
