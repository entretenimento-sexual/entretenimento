// src/app/core/services/general/cache/cache-auth-lifecycle-bridge.service.ts
// Ponte reativa entre a sessão Firebase e o ciclo de vida do cache.
//
// Este serviço não autentica, não navega e não mantém perfil de usuário.
// Ele apenas observa mudanças canônicas de UID e solicita a limpeza adequada.
import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, of } from 'rxjs';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
} from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { CacheSessionLifecycleService } from './cache-session-lifecycle.service';

@Injectable({ providedIn: 'root' })
export class CacheAuthLifecycleBridgeService {
  private started = false;
  private previousUid: string | null | undefined = undefined;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly cacheLifecycle: CacheSessionLifecycleService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly destroyRef: DestroyRef
  ) {}

  /**
   * Inicia uma única observação do UID canônico.
   *
   * Regras:
   * - na primeira emissão, limpa somente o escopo session;
   * - em A -> B, limpa session + user(A) + legado sensível;
   * - em A -> null, aplica a mesma limpeza de encerramento do UID A;
   * - em null -> B, inicia a nova sessão sem resíduos session-scoped.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.authSession.uid$
      .pipe(
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
        }),
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
      (wrapped as any).context = { operation: 'start.uid$' };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // A ponte não deve interferir na sessão por falha de telemetria.
    }
  }
}
