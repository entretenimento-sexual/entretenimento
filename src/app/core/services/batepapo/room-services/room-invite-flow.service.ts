// src/app/core/services/batepapo/room-services/room-invite-flow.service.ts
// Respostas a convites de sala executadas exclusivamente por Cloud Functions.
import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface RoomInviteResponseRequest {
  inviteId: string;
}

interface RoomInviteResponseResult {
  inviteId: string;
  roomId: string;
  status: 'accepted' | 'declined';
  deduplicated: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoomInviteFlowService {
  private readonly acceptRoomInviteCallable: ReturnType<
    typeof httpsCallable<RoomInviteResponseRequest, RoomInviteResponseResult>
  >;

  private readonly declineRoomInviteCallable: ReturnType<
    typeof httpsCallable<RoomInviteResponseRequest, RoomInviteResponseResult>
  >;

  constructor(
    private readonly functions: Functions,
    private readonly globalError: GlobalErrorHandlerService
  ) {
    this.acceptRoomInviteCallable = httpsCallable<
      RoomInviteResponseRequest,
      RoomInviteResponseResult
    >(this.functions, 'acceptRoomInvite');

    this.declineRoomInviteCallable = httpsCallable<
      RoomInviteResponseRequest,
      RoomInviteResponseResult
    >(this.functions, 'declineRoomInvite');
  }

  /**
   * Método público preservado.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - a transação Firestore executada no navegador foi removida;
   * - a escrita em rooms, members, users e invites agora é atômica no backend;
   * - a UI envia somente inviteId e nunca UID, roomId ou membership.
   */
  acceptRoomInvite$(inviteId: string): Observable<void> {
    return this.invokeResponseCallable$(
      inviteId,
      'accepted',
      this.acceptRoomInviteCallable,
      'acceptRoomInvite$'
    );
  }

  /** Método público preservado, agora protegido pela callable. */
  declineRoomInvite$(inviteId: string): Observable<void> {
    return this.invokeResponseCallable$(
      inviteId,
      'declined',
      this.declineRoomInviteCallable,
      'declineRoomInvite$'
    );
  }

  private invokeResponseCallable$(
    inviteId: string,
    expectedStatus: 'accepted' | 'declined',
    callable: ReturnType<
      typeof httpsCallable<RoomInviteResponseRequest, RoomInviteResponseResult>
    >,
    operation: string
  ): Observable<void> {
    const rawInviteId = String(inviteId ?? '').trim();

    return defer(() => {
      const safeInviteId = this.requireInviteId(rawInviteId);

      return from(callable({ inviteId: safeInviteId })).pipe(
        map((result) => {
          this.assertValidResponse(result.data, safeInviteId, expectedStatus);
          return void 0;
        })
      );
    }).pipe(
      catchError((error) =>
        this.reportAndRethrow(error, operation, rawInviteId)
      )
    );
  }

  private requireInviteId(inviteId: string): string {
    const safeInviteId = String(inviteId ?? '').trim();

    if (!/^room:[^:]{1,160}:to:[^:]{1,160}$/.test(safeInviteId)) {
      throw new Error('Convite de sala inválido.');
    }

    return safeInviteId;
  }

  private assertValidResponse(
    result: RoomInviteResponseResult | null | undefined,
    inviteId: string,
    expectedStatus: 'accepted' | 'declined'
  ): void {
    if (
      !result ||
      String(result.inviteId ?? '').trim() !== inviteId ||
      String(result.roomId ?? '').trim().length === 0 ||
      result.status !== expectedStatus
    ) {
      throw new Error('Resposta inválida ao processar convite de sala.');
    }
  }

  private reportAndRethrow(
    error: unknown,
    operation: string,
    inviteId: string
  ): Observable<never> {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[RoomInviteFlowService] operação falhou');

      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;
      (wrapped as any).original = error;
      (wrapped as any).context = operation;
      (wrapped as any).feature = 'room-invites';
      (wrapped as any).extra = { inviteId };

      this.globalError.handleError(wrapped);
    } catch {
      // noop: o Observable ainda propaga a falha ao effect owner do feedback.
    }

    return throwError(() => error);
  }
}
