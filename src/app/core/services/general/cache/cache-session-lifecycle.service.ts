// src/app/core/services/general/cache/cache-session-lifecycle.service.ts
// Coordena a limpeza de cache ligada ao ciclo de autenticação.
//
// Responsabilidades:
// - esconder de Auth/Logout a coexistência temporária entre CacheService legado
//   e AppCacheService;
// - limpar escopo de sessão em toda nova sessão;
// - limpar dados user-scoped do UID anterior em troca de conta;
// - coalescer limpezas concorrentes do mesmo escopo/UID;
// - manter a limpeza best-effort, silenciosa para a interface e observável.
import { Injectable } from '@angular/core';
import { Observable, defer, forkJoin, of } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  shareReplay,
} from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from './app-cache.service';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class CacheSessionLifecycleService {
  private readonly inFlight = new Map<string, Observable<void>>();

  constructor(
    private readonly legacyCache: CacheService,
    private readonly appCache: AppCacheService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * Limpeza executada após logout/hard sign-out.
   * Inclui legado sensível, session scope e user scope conhecido.
   */
  clearAfterLogout$(ownerUid?: string | null): Observable<void> {
    const uid = this.normalizeUid(ownerUid);

    return this.runCleanup$(
      uid ? `full:${uid}` : 'full:anonymous',
      uid,
      true,
      'clearAfterLogout$'
    );
  }

  /**
   * Limpeza executada quando o UID efetivo muda.
   * Sem UID anterior, limpa somente o novo escopo session.
   */
  clearForUidTransition$(previousUid?: string | null): Observable<void> {
    const uid = this.normalizeUid(previousUid);

    return this.runCleanup$(
      uid ? `full:${uid}` : 'session-only',
      uid,
      !!uid,
      'clearForUidTransition$'
    );
  }

  private runCleanup$(
    operationKey: string,
    ownerUid: string | null,
    includeLegacy: boolean,
    operation: string
  ): Observable<void> {
    const existing = this.inFlight.get(operationKey);
    if (existing) return existing;

    const request$ = defer(() => {
      const operations: Observable<unknown>[] = [
        this.appCache.clearSessionScope$(),
      ];

      if (ownerUid) {
        operations.push(this.appCache.clearUserScope$(ownerUid));
      }

      if (includeLegacy) {
        operations.push(this.legacyCache.clearSensitiveSessionCache$());
      }

      return forkJoin(operations).pipe(map(() => void 0));
    }).pipe(
      catchError((error) => {
        this.report(error, operation, {
          hasOwnerUid: !!ownerUid,
          includeLegacy,
        });
        return of(void 0);
      }),
      finalize(() => this.inFlight.delete(operationKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(operationKey, request$);
    return request$;
  }

  private normalizeUid(uid?: string | null): string | null {
    const normalized = String(uid ?? '').trim();
    return normalized || null;
  }

  private report(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[CacheSessionLifecycleService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'cache-session-lifecycle';
      (wrapped as any).context = { operation, ...(context ?? {}) };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // Limpeza de cache não deve bloquear logout nem troca de conta.
    }
  }
}
