// src/app/core/services/general/cache/cache-auth-lifecycle-bridge.service.ts
// Ponte reativa entre a sessão Firebase e o ciclo de vida do cache.
//
// Este serviço não autentica, não navega e não mantém perfil de usuário.
// Ele saneia resíduos legados e observa mudanças canônicas de UID.
import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, concat, of } from 'rxjs';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
} from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { CacheLegacyMigrationService } from './cache-legacy-migration.service';
import { CacheSessionLifecycleService } from './cache-session-lifecycle.service';
import { LEGACY_MEMORY_ONLY_PREFIXES } from './legacy-cache-persistence-policy';

@Injectable({ providedIn: 'root' })
export class CacheAuthLifecycleBridgeService {
  private started = false;
  private previousUid: string | null | undefined = undefined;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly cacheLifecycle: CacheSessionLifecycleService,
    private readonly legacyMigration: CacheLegacyMigrationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly destroyRef: DestroyRef
  ) {}

  /**
   * Inicia uma única sequência:
   * 1) remove resíduos sensíveis conhecidos do cache legado;
   * 2) observa o UID canônico e limpa escopos nas transições.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    concat(
      this.legacyMigration.purgePrefixesOnce$(
        'legacy-sensitive-browser-cache-v2',
        LEGACY_MEMORY_ONLY_PREFIXES
      ),
      this.authSession.uid$.pipe(
        distinctUntilChanged(),
        concatMap((currentUid) => {
          const previousUid = this.previousUid;
          this.previousUid = this.normalizeUid(currentUid);

          if (previousUid === undefined) {
            return this.cacheLifecycle.clearForUidTransition$(null);
          }

          if (previousUid === this.previousUid) {
            return of(void 0);
          }

          return this.cacheLifecycle.clearForUidTransition$(previousUid);
        })
      )
    )
      .pipe(
        catchError((error) => {
          this.report(error);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private normalizeUid(uid: string | null | undefined): string | null {
    const normalized = String(uid ?? '').trim();
    return normalized || null;
  }

  private report(error: unknown): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[CacheAuthLifecycleBridgeService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'cache-auth-lifecycle-bridge';
      (wrapped as any).context = { operation: 'start' };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // A ponte não deve interferir na sessão por falha de telemetria.
    }
  }
}
