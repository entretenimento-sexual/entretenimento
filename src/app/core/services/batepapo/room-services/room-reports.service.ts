// src/app/core/services/batepapo/room-services/room-reports.service.ts
// Compatibilidade de denúncias de Salas legadas. Novas escritas estão congeladas.

import { Injectable } from '@angular/core';
import { Observable, defer, firstValueFrom, throwError } from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class RoomReportsService {
  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * SUPRESSÃO EXPLÍCITA: a escrita direta em `rooms/{roomId}/reports` foi removida.
   * Salas estão em compatibilidade somente-leitura/limpeza e não recebem novos dados.
   */
  reportRoom$(
    roomId: string,
    reason: string,
    userId: string
  ): Observable<void> {
    const rid = String(roomId ?? '').trim();
    const reporterUid = String(userId ?? '').trim();
    void reason;

    return defer(() => {
      const error = new Error(
        'Novas denúncias vinculadas a Salas legadas não estão disponíveis.'
      );
      (error as any).code = 'failed-precondition';
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).context = {
        scope: 'RoomReportsService',
        operation: 'reportRoom$',
        roomId: rid,
        reporterUid,
        productState: 'deprecated_compatibility_only',
      };

      try {
        this.globalError.handleError(error);
      } catch {
        // O bloqueio local não depende da telemetria.
      }

      this.errorNotifier.showInfo(
        'Salas foram descontinuadas. Novas interações coletivas devem ocorrer em Comunidades.'
      );
      return throwError(() => error);
    });
  }

  /** Compatibilidade Promise preservada para consumidores antigos. */
  async reportRoom(roomId: string, reason: string, userId: string): Promise<void> {
    await firstValueFrom(this.reportRoom$(roomId, reason, userId));
  }
}
