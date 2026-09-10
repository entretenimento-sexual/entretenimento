// src/app/core/services/batepapo/room-services/user-room-ids.service.ts
// Compatibilidade da antiga projeção users.roomIds. O cliente não a muta mais.

import { Injectable } from '@angular/core';
import { Observable, defer, firstValueFrom, of, throwError } from 'rxjs';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UserRoomIdsService {
  constructor(
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * SUPRESSÃO EXPLÍCITA: a escrita `users.roomIds = arrayUnion(...)` foi removida.
   * Essa projeção legada não concede membership e não deve voltar a ser autoridade.
   */
  addRoomId$(userId: string, roomId: string): Observable<void> {
    return this.blockDeprecatedProjectionMutation$('addRoomId$', userId, roomId);
  }

  /**
   * SUPRESSÃO EXPLÍCITA: a escrita `users.roomIds = arrayRemove(...)` foi removida.
   */
  removeRoomId$(userId: string, roomId: string): Observable<void> {
    return this.blockDeprecatedProjectionMutation$('removeRoomId$', userId, roomId);
  }

  updateUserRoomIds$(
    userId: string,
    roomId: string,
    action: 'add' | 'remove'
  ): Observable<void> {
    const uid = (userId ?? '').trim();
    const rid = (roomId ?? '').trim();
    if (!uid || !rid) return of(void 0);

    return this.blockDeprecatedProjectionMutation$(
      `updateUserRoomIds$:${action}`,
      uid,
      rid
    );
  }

  updateUserRoomIds(
    userId: string,
    roomId: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    return firstValueFrom(this.updateUserRoomIds$(userId, roomId, action));
  }

  private blockDeprecatedProjectionMutation$(
    operation: string,
    userId: string,
    roomId: string
  ): Observable<void> {
    const uid = (userId ?? '').trim();
    const rid = (roomId ?? '').trim();
    if (!uid || !rid) return of(void 0);

    return defer(() => {
      const error = new Error(
        'A projeção legada de Salas do usuário não pode mais ser alterada pelo cliente.'
      );
      (error as any).code = 'failed-precondition';
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).context = {
        scope: 'UserRoomIdsService',
        operation,
        userId: uid,
        roomId: rid,
        productState: 'deprecated_compatibility_only',
      };

      try {
        this.globalError.handleError(error);
      } catch {
        // O bloqueio local continua mesmo se a telemetria falhar.
      }

      this.notify.showInfo(
        'Salas foram descontinuadas. Membership e papéis pertencem a Comunidades.'
      );
      return throwError(() => error);
    });
  }
}
