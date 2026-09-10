// src/app/core/services/batepapo/room-services/room-invite-flow.service.ts
// Compatibilidade de convites legados: aceite bloqueado; recusa permanece para limpeza.
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
  private readonly declineRoomInviteCallable: ReturnType<
    typeof httpsCallable<RoomInviteResponseRequest, RoomInviteResponseResult>
  >;

  constructor(
    private readonly functions: Functions,
    private readonly globalError: GlobalErrorHandlerService
  ) {
    this.declineRoomInviteCallable = httpsCallable<
      RoomInviteResponseRequest,
      RoomInviteResponseResult
    >(this.functions, 'declineRoomInvite');
  }

  /**
   * Método público preservado para compatibilidade.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - o cliente não chama mais a operação de aceite;
   * - aceitar convite legado criaria membership novo em um domínio depreciado;
   * - a falha acontece localmente e de forma observável, sem tráfego de rede.
   */
  acceptRoomInvite$(inviteId: string): Observable<void> {
    const rawInviteId = String(inviteId ?? '').trim();

    return defer(() => {
      this.requireInviteId(rawInviteId);
      const error = new Error(
        'Convites legados de Sala não podem mais ser aceitos. Use Comunidades para interações coletivas.'
      );
      (error as any).code = 'failed-precondition';
      return this.reportAndRethrow(error, 'acceptRoomInvite$', rawInviteId);
    });
  }

  /** A recusa continua permitida para limpar convites legados pendentes. */
  declineRoomInvite$(inviteId: string): Observable<void> {
    const rawInviteId = String(inviteId ?? '').trim();

    return defer(() => {
      const safeInviteId = this.requireInviteId(rawInviteId);

      return from(
        this.declineRoomInviteCallable({ inviteId: safeInviteId })
      ).pipe(
        map((result) => {
          this.assertValidDeclineResponse(result.data, safeInviteId);
          return void 0;
        })
      );
    }).pipe(
      catchError((error) =>
        this.reportAndRethrow(error, 'declineRoomInvite$', rawInviteId)
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

  private assertValidDeclineResponse(
    result: RoomInviteResponseResult | null | undefined,
    inviteId: string
  ): void {
    if (
      !result ||
      String(result.inviteId ?? '').trim() !== inviteId ||
      String(result.roomId ?? '').trim().length === 0 ||
      result.status !== 'declined'
    ) {
      throw new Error('Resposta inválida ao recusar convite de sala.');
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
      // O Observable ainda propaga a falha ao owner do feedback.
    }

    return throwError(() => error);
  }
}
