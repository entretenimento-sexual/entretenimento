// src/app/core/services/general/cache/cache-session-lifecycle.service.ts
// Coordena a limpeza de cache ligada ao ciclo de autenticação.
//
// Responsabilidades:
// - esconder de Auth/Logout a coexistência temporária entre CacheService legado
//   e AppCacheService;
// - limpar escopo de sessão em toda nova sessão;
// - limpar dados user-scoped do UID anterior em troca de conta;
// - manter a limpeza best-effort, silenciosa para a interface e observável.
import { Injectable } from '@angular/core';
import { Observable, defer, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from './app-cache.service';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class CacheSessionLifecycleService {
  constructor(
    private readonly legacyCache: CacheService,
    private readonly appCache: AppCacheService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * Limpeza executada após logout/hard sign-out.
   *
   * Inclui:
   * - rastros sensíveis do cache legado;
   * - todo o escopo session da nova fachada;
   * - todo o escopo user do UID encerrado, quando conhecido.
   */
  clearAfterLogout$(ownerUid?: string | null): Observable<void> {
    const uid = this.normalizeUid(ownerUid);

    return defer(() => {
      const operations: Observable<unknown>[] = [
        this.legacyCache.clearSensitiveSessionCache$(),
        this.appCache.clearSessionScope$(),
      ];

      if (uid) {
        operations.push(this.appCache.clearUserScope$(uid));
      }

      return forkJoin(operations).pipe(map(() => void 0));
    }).pipe(
      catchError((error) => {
        this.report(error, 'clearAfterLogout$', { hasOwnerUid: !!uid });
        return of(void 0);
      })
    );
  }

  /**
   * Limpeza executada quando o UID efetivo muda.
   *
   * Regras:
   * - sempre inicia a nova sessão sem resíduos session-scoped;
   * - se havia UID anterior, limpa o user scope correspondente;
   * - somente em troca real de conta também limpa o cache legado sensível.
   */
  clearForUidTransition$(previousUid?: string | null): Observable<void> {
    const uid = this.normalizeUid(previousUid);

    return defer(() => {
      const operations: Observable<unknown>[] = [
        this.appCache.clearSessionScope$(),
      ];

      if (uid) {
        operations.push(
          this.appCache.clearUserScope$(uid),
          this.legacyCache.clearSensitiveSessionCache$()
        );
      }

      return forkJoin(operations).pipe(map(() => void 0));
    }).pipe(
      catchError((error) => {
        this.report(error, 'clearForUidTransition$', {
          hadPreviousUid: !!uid,
        });
        return of(void 0);
      })
    );
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
