import { Injectable, InjectionToken } from '@angular/core';
import { Observable, catchError, defer, map, of, tap } from 'rxjs';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { CacheMetricsService } from './cache-metrics.service';
import {
  CachePersistenceCleanupResult,
  CachePersistenceService,
} from './cache-persistence.service';

const SESSION_FLAG = 'cache-maintenance:v1:scheduled';
const CURSOR_KEY = 'cache-maintenance:v1:cursor';

export const CACHE_MAINTENANCE_AUTO_START = new InjectionToken<boolean>(
  'CACHE_MAINTENANCE_AUTO_START',
  {
    providedIn: 'root',
    factory: () => true,
  }
);

interface IdleCapableGlobal {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number }
  ) => number;
}

/**
 * Executa manutenção local em momento ocioso, no máximo uma vez por sessão.
 *
 * A rotina não bloqueia o bootstrap, não envia telemetria e mantém somente um
 * cursor numérico sem relação com usuários ou conteúdo das chaves.
 */
@Injectable({ providedIn: 'root' })
export class CacheMaintenanceService {
  private scheduledInMemory = false;

  constructor(
    private readonly persistence: CachePersistenceService,
    private readonly metrics: CacheMetricsService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  scheduleOncePerSession(batchSize = 40): void {
    if (this.scheduledInMemory || this.wasScheduledInSession()) return;

    this.scheduledInMemory = true;
    this.markScheduledInSession();

    const run = () => {
      this.runCleanup$(batchSize).subscribe();
    };

    const idle = (globalThis as IdleCapableGlobal).requestIdleCallback;
    if (typeof idle === 'function') {
      idle(run, { timeout: 3_000 });
      return;
    }

    setTimeout(run, 1_500);
  }

  runCleanup$(
    batchSize = 40
  ): Observable<CachePersistenceCleanupResult | null> {
    return defer(() => {
      const startedAt = this.now();
      const cursor = this.readCursor();

      return this.persistence
        .cleanupExpiredEntries({ batchSize, cursor })
        .pipe(
          tap((result) => {
            this.writeCursor(result.nextCursor);
            this.metrics.recordMaintenance({
              scanned: result.scanned,
              removed: result.removed,
              invalid: result.invalid,
              expired: result.expired,
              durationMs: this.now() - startedAt,
              completedAt: Date.now(),
            });
            this.privacyDebug.log('cache', 'CacheMaintenanceService: limpeza concluída.', {
              totalKeys: result.totalKeys,
              scanned: result.scanned,
              removed: result.removed,
              invalid: result.invalid,
              expired: result.expired,
              nextCursor: result.nextCursor,
            });
          }),
          map((result) => result as CachePersistenceCleanupResult | null),
          catchError((error: unknown) => {
            this.reportError(error);
            return of(null);
          })
        );
    });
  }

  private wasScheduledInSession(): boolean {
    try {
      return sessionStorage.getItem(SESSION_FLAG) === '1';
    } catch {
      return false;
    }
  }

  private markScheduledInSession(): void {
    try {
      sessionStorage.setItem(SESSION_FLAG, '1');
    } catch {
      // A proteção em memória continua ativa.
    }
  }

  private readCursor(): number {
    try {
      const value = Number(localStorage.getItem(CURSOR_KEY));
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    } catch {
      return 0;
    }
  }

  private writeCursor(cursor: number): void {
    try {
      localStorage.setItem(CURSOR_KEY, String(Math.max(0, Math.floor(cursor))));
    } catch {
      // A próxima sessão reinicia a partir do começo.
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private reportError(error: unknown): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('Falha na manutenção incremental do cache local.');
      const reportable = normalized as Error & {
        original?: unknown;
        skipUserNotification?: boolean;
        context?: Record<string, unknown>;
      };

      reportable.original = error;
      reportable.skipUserNotification = true;
      reportable.context = {
        scope: 'CacheMaintenanceService',
        operation: 'cleanupExpiredEntries',
      };

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // noop
    }
  }
}
