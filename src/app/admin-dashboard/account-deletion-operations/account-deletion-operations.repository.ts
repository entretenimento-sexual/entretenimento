// src/app/admin-dashboard/account-deletion-operations/account-deletion-operations.repository.ts
// -----------------------------------------------------------------------------
// ADMIN ACCOUNT DELETION OPERATIONS REPOSITORY
// -----------------------------------------------------------------------------
// Observable-first, normalização defensiva e diagnóstico centralizado.
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

import {
  AccountDeletionOperationFilter,
  AccountDeletionOperationItem,
  AccountDeletionOperationStatus,
  AccountDeletionOperationsCursor,
  AccountDeletionOperationsRequest,
  AccountDeletionOperationsResponse,
} from './account-deletion-operations.model';

@Injectable({ providedIn: 'root' })
export class AccountDeletionOperationsRepository {
  private readonly functions = inject(Functions);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly debug = !!environment.enableDebugTools;

  listOperations$(
    request: AccountDeletionOperationsRequest
  ): Observable<AccountDeletionOperationsResponse> {
    const payload = this.normalizeRequest(request);

    return defer(() =>
      runInInjectionContext(this.environmentInjector, () => {
        const callable = httpsCallable<
          AccountDeletionOperationsRequest,
          unknown
        >(this.functions, 'getAccountDeletionOperations');
        return callable(payload);
      })
    ).pipe(
      map((result) => this.normalizeResponse(result.data)),
      catchError((error: unknown) => {
        this.report(error, {
          context: 'AccountDeletionOperationsRepository.listOperations$',
          filter: payload.filter,
          pageSize: payload.limit,
          hasCursor: payload.cursor !== null,
        });
        this.notifications.showError(
          this.resolveUserMessage(error)
        );
        return throwError(() => error);
      })
    );
  }

  private normalizeRequest(
    request: AccountDeletionOperationsRequest
  ): AccountDeletionOperationsRequest {
    return {
      filter: this.normalizeFilter(request.filter),
      limit: this.normalizeBoundedInteger(request.limit, 20, 1, 50),
      cursor: this.normalizeCursor(request.cursor),
    };
  }

  private normalizeResponse(value: unknown): AccountDeletionOperationsResponse {
    const source = this.normalizeRecord(value);
    const metrics = this.normalizeRecord(source['metrics']);

    return {
      items: Array.isArray(source['items'])
        ? source['items']
          .slice(0, 50)
          .map((item) => this.normalizeItem(item))
          .filter((item): item is AccountDeletionOperationItem => item !== null)
        : [],
      metrics: {
        total: this.normalizeCount(metrics['total']),
        attention: this.normalizeCount(metrics['attention']),
        inProgress: this.normalizeCount(metrics['inProgress']),
        blocked: this.normalizeCount(metrics['blocked']),
        retryScheduled: this.normalizeCount(metrics['retryScheduled']),
        completed: this.normalizeCount(metrics['completed']),
      },
      nextCursor: this.normalizeCursor(source['nextCursor']),
      hasMore: source['hasMore'] === true,
      generatedAt: this.normalizeEpoch(source['generatedAt']) ?? Date.now(),
    };
  }

  private normalizeItem(value: unknown): AccountDeletionOperationItem | null {
    const source = this.normalizeRecord(value);
    const reference = String(source['reference'] ?? '')
      .trim()
      .toLowerCase();

    if (!/^[a-f0-9]{16}$/.test(reference)) return null;

    return {
      reference,
      status: this.normalizeStatus(source['status']),
      phase: this.normalizeToken(source['phase'], 80) || 'pending',
      source: this.normalizeSource(source['source']),
      attemptCount: this.normalizeCount(source['attemptCount']),
      policyVersion: this.normalizeNullableCount(source['policyVersion']),
      authDeletionStatus:
        this.normalizeToken(source['authDeletionStatus'], 80) || 'unknown',
      firestoreDeletionStatus:
        this.normalizeToken(source['firestoreDeletionStatus'], 80) || 'unknown',
      dataDeletionStatus:
        this.normalizeToken(source['dataDeletionStatus'], 80) || 'unknown',
      completedDomainCount: this.normalizeCount(
        source['completedDomainCount']
      ),
      blockingDomains: this.normalizeStringArray(
        source['blockingDomains'],
        20,
        80
      ),
      nextAttemptAt: this.normalizeEpoch(source['nextAttemptAt']),
      retryDelayMs: this.normalizeEpoch(source['retryDelayMs']),
      leaseUntil: this.normalizeEpoch(source['leaseUntil']),
      lastErrorCode: this.normalizeNullableToken(
        source['lastErrorCode'],
        120
      ),
      lastErrorCategory: this.normalizeNullableToken(
        source['lastErrorCategory'],
        80
      ),
      lastErrorPhase: this.normalizeNullableToken(
        source['lastErrorPhase'],
        80
      ),
      deletionRequestedAt: this.normalizeEpoch(
        source['deletionRequestedAt']
      ),
      deletedAt: this.normalizeEpoch(source['deletedAt']),
      purgeAfter: this.normalizeEpoch(source['purgeAfter']),
      updatedAt: this.normalizeEpoch(source['updatedAt']) ?? 0,
    };
  }

  private normalizeFilter(value: unknown): AccountDeletionOperationFilter {
    return value === 'in_progress' ||
      value === 'blocked' ||
      value === 'retry_scheduled' ||
      value === 'completed' ||
      value === 'all'
      ? value
      : 'attention';
  }

  private normalizeStatus(value: unknown): AccountDeletionOperationStatus {
    return value === 'in_progress' ||
      value === 'blocked' ||
      value === 'retry_scheduled' ||
      value === 'completed'
      ? value
      : 'pending';
  }

  private normalizeSource(
    value: unknown
  ): AccountDeletionOperationItem['source'] {
    return value === 'self' || value === 'moderator' || value === 'system'
      ? value
      : 'unknown';
  }

  private normalizeCursor(value: unknown): AccountDeletionOperationsCursor | null {
    const source = this.normalizeRecord(value);
    const updatedAt = this.normalizeEpoch(source['updatedAt']);
    const reference = String(source['reference'] ?? '')
      .trim()
      .toLowerCase();

    return updatedAt && /^[a-f0-9]{16}$/.test(reference)
      ? { updatedAt, reference }
      : null;
  }

  private normalizeStringArray(
    value: unknown,
    maximumItems: number,
    maximumLength: number
  ): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(
      value
        .map((item) => this.normalizeToken(item, maximumLength))
        .filter(Boolean)
    )].slice(0, maximumItems);
  }

  private normalizeToken(value: unknown, maximum: number): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maximum);
  }

  private normalizeNullableToken(
    value: unknown,
    maximum: number
  ): string | null {
    const normalized = this.normalizeToken(value, maximum);
    return normalized || null;
  }

  private normalizeCount(value: unknown): number {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private normalizeNullableCount(value: unknown): number | null {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private normalizeEpoch(value: unknown): number | null {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private normalizeBoundedInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
  ): number {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, minimum), maximum)
      : fallback;
  }

  private normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private resolveUserMessage(error: unknown): string {
    const source = (error ?? {}) as {
      code?: unknown;
      details?: unknown;
    };
    const code = String(source.code ?? '').toLowerCase();
    const details = this.normalizeRecord(source.details);
    const reason = String(details['reason'] ?? '').toLowerCase();

    if (reason === 'account-deletion-operations-cursor-expired') {
      return 'A lista mudou enquanto você navegava. Atualize a consulta.';
    }
    if (code.includes('permission-denied')) {
      return 'Sua conta não possui permissão para consultar exclusões.';
    }
    if (code.includes('unauthenticated')) {
      return 'Sua sessão terminou. Entre novamente para continuar.';
    }
    return 'Não foi possível carregar as operações de exclusão.';
  }

  private report(error: unknown, context: Record<string, unknown>): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.debug('[AccountDeletionOperationsRepository]', context, error);
      }

      const normalized = error instanceof Error
        ? error
        : new Error('[AccountDeletionOperationsRepository] operação falhou');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: unknown;
        skipUserNotification?: boolean;
        silent?: boolean;
      };
      contextual.original = error;
      contextual.context = context;
      contextual.skipUserNotification = true;
      contextual.silent = true;
      this.globalErrorHandler.handleError(contextual);
    } catch {
      // A telemetria não interrompe o fluxo principal.
    }
  }
}
