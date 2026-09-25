// src/app/account/application/account-lifecycle.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE SERVICE
// -----------------------------------------------------------------------------
// - Centraliza callables do lifecycle da conta.
// - Mantém API Observable-first e nomes públicos existentes.
// - Normaliza entradas antes da rede.
// - Centraliza apresentação e diagnóstico técnico no ApplicationErrorService.
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

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { AccountStatus } from '../models/account-lifecycle.model';

export interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: AccountStatus | string | null;
  publicVisibility?: 'visible' | 'hidden' | null;
  interactionBlocked?: boolean | null;
  loginAllowed?: boolean | null;
  suspended?: boolean | null;

  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | null;
  suspensionEndsAt?: number | null;

  deletionRequestedAt?: number | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  statusUpdatedAt?: number | null;
  subscriptionRenewalStatus?: 'active' | 'canceled' | 'none' | null;
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
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly maxReasonLength = 500;

  // ---------------------------------------------------------------------------
  // SELF ACTIONS
  // ---------------------------------------------------------------------------

  requestSelfSuspension$(
    reason?: string | null
  ): Observable<AccountLifecycleCommandResult> {
    const safeReason = this.normalizeOptionalReason(reason);
    const invalidReason = this.validateReason(safeReason, false);
    if (invalidReason) return invalidReason;

    return this.callFunction$<
      RequestSelfSuspensionPayload,
      AccountLifecycleCommandResult
    >(
      'requestSelfSuspension',
      { reason: safeReason },
      {
        context: 'AccountLifecycleService.requestSelfSuspension$',
        userMessage: 'Não foi possível suspender a conta agora.',
      }
    );
  }

  reactivateSelfSuspension$(): Observable<AccountLifecycleCommandResult> {
    return this.callFunction$<
      Record<string, never>,
      AccountLifecycleCommandResult
    >(
      'reactivateSelfSuspension',
      {},
      {
        context: 'AccountLifecycleService.reactivateSelfSuspension$',
        userMessage: 'Não foi possível reativar a conta agora.',
      }
    );
  }

  requestAccountDeletion$(
    reason?: string | null
  ): Observable<AccountLifecycleCommandResult> {
    const safeReason = this.normalizeOptionalReason(reason);
    const invalidReason = this.validateReason(safeReason, false);
    if (invalidReason) return invalidReason;

    return this.callFunction$<
      RequestAccountDeletionPayload,
      AccountLifecycleCommandResult
    >(
      'requestAccountDeletion',
      { reason: safeReason },
      {
        context: 'AccountLifecycleService.requestAccountDeletion$',
        userMessage: 'Não foi possível iniciar a exclusão da conta agora.',
      }
    );
  }

  cancelAccountDeletion$(): Observable<AccountLifecycleCommandResult> {
    return this.callFunction$<
      Record<string, never>,
      AccountLifecycleCommandResult
    >(
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
      return this.invalidInput$(
        'UID do usuário alvo inválido.',
        'moderation/invalid-target'
      );
    }

    const invalidReason = this.validateReason(safeReason, true);
    if (invalidReason) return invalidReason;

    const payload: ModerateSuspendAccountPayload = {
      targetUid: safeTargetUid,
      reason: safeReason,
      endsAt: this.normalizeOptionalEpoch(endsAt),
    };

    return this.callFunction$<
      ModerateSuspendAccountPayload,
      AccountLifecycleCommandResult
    >(
      'moderateSuspendAccount',
      payload,
      {
        context: 'AccountLifecycleService.moderateSuspendAccount$',
        userMessage: 'Não foi possível suspender a conta do usuário.',
      }
    );
  }

  moderateUnsuspendAccount$(
    targetUid: string
  ): Observable<AccountLifecycleCommandResult> {
    const safeTargetUid = this.normalizeUid(targetUid);

    if (!safeTargetUid) {
      return this.invalidInput$(
        'UID do usuário alvo inválido.',
        'moderation/invalid-target'
      );
    }

    return this.callFunction$<
      ModerateUnsuspendAccountPayload,
      AccountLifecycleCommandResult
    >(
      'moderateUnsuspendAccount',
      { targetUid: safeTargetUid },
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
      return this.invalidInput$(
        'UID do usuário alvo inválido.',
        'moderation/invalid-target'
      );
    }

    const invalidReason = this.validateReason(safeReason, true);
    if (invalidReason) return invalidReason;

    const payload: ModerateScheduleDeletionPayload = {
      targetUid: safeTargetUid,
      reason: safeReason,
      undoWindowMs: this.normalizeOptionalWindow(undoWindowMs),
    };

    return this.callFunction$<
      ModerateScheduleDeletionPayload,
      AccountLifecycleCommandResult
    >(
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

  private callFunction$<
    TPayload,
    TResult extends AccountLifecycleCommandResult,
  >(
    functionName: string,
    payload: TPayload,
    opts: { context: string; userMessage: string }
  ): Observable<TResult> {
    return defer(() =>
      runInInjectionContext(this.envInjector, () => {
        const callable = httpsCallable<TPayload, TResult>(
          this.functions,
          functionName
        );
        return callable(payload);
      })
    ).pipe(
      map((result) => result.data),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'account-lifecycle',
          operation: opts.context,
          fallbackMessage: opts.userMessage,
          codeMessages: {
            unauthenticated:
              'Sua sessão terminou. Entre novamente para continuar.',
            'permission-denied':
              'Sua conta não pode executar esta ação no estado atual.',
            'invalid-argument':
              'Revise os dados informados e tente novamente.',
          },
          reasonMessages: this.resolveReasonMessages(error, opts.context),
          metadata: {
            scope: 'AccountLifecycleService',
            phase: 'callFunction$',
            functionName,
            payloadKeys: Object.keys((payload as object | null) ?? {}),
          },
        });

        return throwError(() => error);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // VALIDATION / NORMALIZATION
  // ---------------------------------------------------------------------------

  private normalizeUid(uid: string): string {
    return String(uid ?? '').trim();
  }

  private normalizeOptionalReason(reason?: string | null): string | null {
    const safe = this.normalizeReason(reason);
    return safe || null;
  }

  private normalizeRequiredReason(reason: string): string {
    return this.normalizeReason(reason);
  }

  private normalizeReason(reason: unknown): string {
    return String(reason ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateReason(
    reason: string | null,
    required: boolean
  ): Observable<AccountLifecycleCommandResult> | null {
    if (required && !reason) {
      return this.invalidInput$(
        'Motivo obrigatório.',
        'lifecycle/invalid-reason'
      );
    }

    if (reason && reason.length > this.maxReasonLength) {
      return this.invalidInput$(
        `O motivo deve ter no máximo ${this.maxReasonLength} caracteres.`,
        'lifecycle/reason-too-long'
      );
    }

    return null;
  }

  private normalizeOptionalEpoch(value?: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value > 0 ? Math.trunc(value) : null;
  }

  private normalizeOptionalWindow(value?: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value > 0 ? Math.trunc(value) : null;
  }

  private invalidInput$<T>(message: string, code: string): Observable<T> {
    const error = new Error(message) as Error & {
      code?: string;
    };
    error.code = code;

    this.applicationError.report(error, {
      feature: 'account-lifecycle',
      operation: 'invalidInput',
      fallbackMessage: message,
      codeMessages: {
        [code]: message,
      },
      metadata: {
        scope: 'AccountLifecycleService',
        phase: 'invalidInput',
        code,
      },
    });

    return throwError(() => error);
  }

  private resolveReasonMessages(
    error: unknown,
    context: string
  ): Readonly<Record<string, string>> {
    const source = this.asRecord(error);
    const details = this.asRecord(source?.['details']);
    const rawReason = this.safeString(details?.['reason']);
    if (!rawReason) return {};

    switch (rawReason.toLowerCase()) {
      case 'recent-authentication-required':
        return {
          [rawReason]:
            'Por segurança, saia e entre novamente antes de repetir esta ação.',
        };
      case 'moderation-suspension-active':
        return {
          [rawReason]:
            'Uma suspensão aplicada pela moderação não pode ser alterada por esta ação.',
        };
      case 'deletion-undo-window-expired':
        return {
          [rawReason]: 'O prazo para cancelar a exclusão já terminou.',
        };
      case 'owned-resources-require-resolution':
        return {
          [rawReason]: this.resolveOwnedResourcesMessage(
            details ?? {},
            context
          ),
        };
      default:
        return {};
    }
  }

  private resolveOwnedResourcesMessage(
    details: Record<string, unknown>,
    context: string
  ): string {
    const activeRoomCount = this.normalizeNonNegativeCount(
      details['activeOwnedRoomCount']
    );
    const ownedCommunityCount = this.normalizeNonNegativeCount(
      details['ownedCommunityCount']
    );
    const moderatedDeletion =
      context.includes('moderateScheduleDeletion');

    if (moderatedDeletion) {
      if (activeRoomCount > 0 && ownedCommunityCount > 0) {
        return 'Resolva as Salas ativas e as Comunidades sob responsabilidade do usuário antes de agendar a exclusão.';
      }
      if (activeRoomCount > 0) {
        return 'Resolva as Salas ativas sob responsabilidade do usuário antes de agendar a exclusão.';
      }
      if (ownedCommunityCount > 0) {
        return 'Transfira ou arquive as Comunidades sob responsabilidade do usuário antes de agendar a exclusão.';
      }
    }

    if (activeRoomCount > 0 && ownedCommunityCount > 0) {
      return 'Encerre suas Salas ativas e transfira ou arquive suas Comunidades antes de excluir a conta.';
    }

    if (activeRoomCount > 0) {
      return 'Encerre suas Salas ativas antes de excluir a conta.';
    }

    if (ownedCommunityCount > 0) {
      return 'Transfira ou arquive suas Comunidades antes de excluir a conta.';
    }

    return 'Resolva os espaços sob sua responsabilidade antes de excluir a conta.';
  }

  private normalizeNonNegativeCount(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private safeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
  }
}
