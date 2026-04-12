// src/app/account/application/account-lifecycle.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE SERVICE
//
// Objetivo:
// - Centralizar chamadas do domínio de lifecycle da conta
// - Manter Observable-first
// - Não fazer subscribe interno
// - Integrar com Cloud Functions callable
// - Reportar erros de forma centralizada
//
// Observação importante:
// - Os nomes das functions abaixo DEVEM casar com os nomes exportados no backend.
// - Este service não deriva estado; isso continua com a façade.
// - Nesta versão, a criação/execução de httpsCallable ocorre dentro de
//   Injection Context explícito para evitar warnings do AngularFire.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

export interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

interface RequestSelfSuspensionPayload {
  reason?: string | null;
}

interface ModerateSuspendAccountPayload {
  targetUid: string;
  reason: string;
  endsAt?: number | null;
}

interface ModerateUnsuspendAccountPayload {
  targetUid: string;
}

interface RequestAccountDeletionPayload {
  reason?: string | null;
}

interface ModerateScheduleDeletionPayload {
  targetUid: string;
  reason: string;
  undoWindowMs?: number | null;
}

@Injectable({ providedIn: 'root' })
export class AccountLifecycleService {
  private readonly functions = inject(Functions);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  private readonly debug = !!environment.enableDebugTools;

  // ---------------------------------------------------------------------------
  // SELF ACTIONS
  // ---------------------------------------------------------------------------

  requestSelfSuspension$(reason?: string | null): Observable<AccountLifecycleCommandResult> {
    const payload: RequestSelfSuspensionPayload = {
      reason: this.normalizeOptionalReason(reason),
    };

    return this.callFunction$<RequestSelfSuspensionPayload, AccountLifecycleCommandResult>(
      'requestSelfSuspension',
      payload,
      {
        context: 'AccountLifecycleService.requestSelfSuspension$',
        userMessage: 'Não foi possível suspender a conta agora.',
      }
    );
  }

  reactivateSelfSuspension$(): Observable<AccountLifecycleCommandResult> {
    return this.callFunction$<Record<string, never>, AccountLifecycleCommandResult>(
      'reactivateSelfSuspension',
      {},
      {
        context: 'AccountLifecycleService.reactivateSelfSuspension$',
        userMessage: 'Não foi possível reativar a conta agora.',
      }
    );
  }

  requestAccountDeletion$(reason?: string | null): Observable<AccountLifecycleCommandResult> {
    const payload: RequestAccountDeletionPayload = {
      reason: this.normalizeOptionalReason(reason),
    };

    return this.callFunction$<RequestAccountDeletionPayload, AccountLifecycleCommandResult>(
      'requestAccountDeletion',
      payload,
      {
        context: 'AccountLifecycleService.requestAccountDeletion$',
        userMessage: 'Não foi possível iniciar a exclusão da conta agora.',
      }
    );
  }

  cancelAccountDeletion$(): Observable<AccountLifecycleCommandResult> {
    return this.callFunction$<Record<string, never>, AccountLifecycleCommandResult>(
      'cancelAccountDeletion',
      {},
      {
        context: 'AccountLifecycleService.cancelAccountDeletion$',
        userMessage: 'Não foi possível cancelar a exclusão da conta agora.',
      }
    );
  }

  // ---------------------------------------------------------------------------
  // MODERATION ACTIONS
  // ---------------------------------------------------------------------------

  moderateSuspendAccount$(
    targetUid: string,
    reason: string,
    endsAt?: number | null
  ): Observable<AccountLifecycleCommandResult> {
    const safeTargetUid = this.normalizeUid(targetUid);
    const safeReason = this.normalizeRequiredReason(reason);

    if (!safeTargetUid) {
      return this.invalidInput$('UID do usuário alvo inválido.', 'moderation/invalid-target');
    }

    if (!safeReason) {
      return this.invalidInput$('Motivo da suspensão é obrigatório.', 'moderation/invalid-reason');
    }

    const payload: ModerateSuspendAccountPayload = {
      targetUid: safeTargetUid,
      reason: safeReason,
      endsAt: this.normalizeOptionalEpoch(endsAt),
    };

    return this.callFunction$<ModerateSuspendAccountPayload, AccountLifecycleCommandResult>(
      'moderateSuspendAccount',
      payload,
      {
        context: 'AccountLifecycleService.moderateSuspendAccount$',
        userMessage: 'Não foi possível suspender a conta do usuário.',
      }
    );
  }

  moderateUnsuspendAccount$(targetUid: string): Observable<AccountLifecycleCommandResult> {
    const safeTargetUid = this.normalizeUid(targetUid);

    if (!safeTargetUid) {
      return this.invalidInput$('UID do usuário alvo inválido.', 'moderation/invalid-target');
    }

    const payload: ModerateUnsuspendAccountPayload = {
      targetUid: safeTargetUid,
    };

    return this.callFunction$<ModerateUnsuspendAccountPayload, AccountLifecycleCommandResult>(
      'moderateUnsuspendAccount',
      payload,
      {
        context: 'AccountLifecycleService.moderateUnsuspendAccount$',
        userMessage: 'Não foi possível reativar a conta do usuário.',
      }
    );
  }

  moderateScheduleDeletion$(
    targetUid: string,
    reason: string,
    undoWindowMs?: number | null
  ): Observable<AccountLifecycleCommandResult> {
    const safeTargetUid = this.normalizeUid(targetUid);
    const safeReason = this.normalizeRequiredReason(reason);

    if (!safeTargetUid) {
      return this.invalidInput$('UID do usuário alvo inválido.', 'moderation/invalid-target');
    }

    if (!safeReason) {
      return this.invalidInput$('Motivo da exclusão é obrigatório.', 'moderation/invalid-reason');
    }

    const payload: ModerateScheduleDeletionPayload = {
      targetUid: safeTargetUid,
      reason: safeReason,
      undoWindowMs: this.normalizeOptionalWindow(undoWindowMs),
    };

    return this.callFunction$<ModerateScheduleDeletionPayload, AccountLifecycleCommandResult>(
      'moderateScheduleDeletion',
      payload,
      {
        context: 'AccountLifecycleService.moderateScheduleDeletion$',
        userMessage: 'Não foi possível agendar a exclusão da conta do usuário.',
      }
    );
  }

  // ---------------------------------------------------------------------------
  // CORE CALLABLE
  // ---------------------------------------------------------------------------

  private callFunction$<TPayload, TResult extends AccountLifecycleCommandResult>(
    functionName: string,
    payload: TPayload,
    opts: {
      context: string;
      userMessage: string;
    }
  ): Observable<TResult> {
    return defer(() =>
      runInInjectionContext(this.envInjector, () => {
        const callable = httpsCallable<TPayload, TResult>(this.functions, functionName);
        return callable(payload);
      })
    ).pipe(
      map((result: any) => result.data as TResult),
      catchError((err) => {
        this.report(err, {
          phase: 'callFunction$',
          functionName,
          context: opts.context,
          payloadKeys: Object.keys((payload as any) ?? {}),
        });

        this.errorNotifier.showError(opts.userMessage);
        return throwError(() => err);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // VALIDATION / NORMALIZATION
  // ---------------------------------------------------------------------------

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private normalizeOptionalReason(reason?: string | null): string | null {
    const safe = (reason ?? '').trim();
    return safe || null;
  }

  private normalizeRequiredReason(reason: string): string {
    return (reason ?? '').trim();
  }

  private normalizeOptionalEpoch(value?: number | null): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return value > 0 ? value : null;
  }

  private normalizeOptionalWindow(value?: number | null): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return value > 0 ? value : null;
  }

  private invalidInput$<T>(message: string, code: string): Observable<T> {
    const error = new Error(message);
    (error as any).code = code;

    this.report(error, {
      phase: 'invalidInput',
      code,
      message,
    });

    this.errorNotifier.showError(message);
    return throwError(() => error);
  }

  // ---------------------------------------------------------------------------
  // ERROR REPORT
  // ---------------------------------------------------------------------------

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log('[AccountLifecycleService]', context, err);
      }

      const error = new Error('[AccountLifecycleService] internal error');
      (error as any).silent = false;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }
} // Linha 312