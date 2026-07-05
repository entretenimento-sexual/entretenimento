// src/app/store/effects/effects.user/online-users-effect-feedback.service.ts
// =============================================================================
// SERVIÇO: ONLINE USERS EFFECT FEEDBACK
// =============================================================================
//
// Responsabilidade:
// - centralizar debug controlado do OnlineUsersEffects;
// - transformar erro bruto em IError de store;
// - encaminhar erro ao GlobalErrorHandlerService;
// - notificar usuário com throttling para evitar spam.
//
// Regra de arquitetura:
// - este service NÃO consulta Firestore;
// - este service NÃO despacha actions NgRx;
// - este service NÃO altera presença;
// - este service NÃO hidrata perfil;
// - este service só cuida de feedback, erro e observabilidade do effect.

import { Injectable, inject } from '@angular/core';

import { IError } from '@core/interfaces/ierror';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

import { toStoreError } from 'src/app/store/utils/store-error.serializer';

@Injectable({ providedIn: 'root' })
export class OnlineUsersEffectFeedbackService {
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private lastNotifyAt = 0;

  canDebug(): boolean {
    return this.privacyDebug.canLog('online-users');
  }

  debug(msg: string, extra?: unknown): void {
    this.privacyDebug.log('online-users', msg, extra);
  }

  reportEffectError(
    err: unknown,
    fallbackMsg: string,
    context: string,
    extra?: Record<string, unknown>
  ): IError {
    const storeErr = toStoreError(err, fallbackMsg, context, extra);

    const error = err instanceof Error ? err : new Error(storeErr.message);

    /**
     * Mantém compatibilidade com o tratamento centralizado já usado no projeto.
     * A notificação ao usuário é controlada por notifyOnce(), evitando spam.
     */
    (error as any).silent = true;
    (error as any).context = context;
    (error as any).original = err;
    (error as any).extra = storeErr.extra;

    this.globalErrorHandler.handleError(error);
    this.notifyOnce(storeErr.message);

    return storeErr;
  }

  private notifyOnce(msg: string): void {
    const now = Date.now();

    if (now - this.lastNotifyAt > 15_000) {
      this.lastNotifyAt = now;
      this.errorNotifier.showError(msg);
    }
  }
}
