// src/app/store/effects/cache.effects.ts
// Efeito legado de compatibilidade para actions genéricas de cache.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDO o espelho de `currentUser` no localStorage.
//   Motivo: o objeto completo do perfil não pode contornar a política de
//   privacidade aplicada pelo CachePersistenceService.
// - SUPRIMIDOS toast e console.error em falhas de IndexedDB.
//   Motivo: cache é infraestrutura best-effort; detalhes seguem silenciosamente
//   para o GlobalErrorHandlerService e não devem alarmar o usuário.
//
// Este effect permanece apenas enquanto o slice genérico de cache não for
// removido. Novos fluxos devem usar AppCacheService.
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { EMPTY } from 'rxjs';
import {
  auditTime,
  catchError,
  groupBy,
  mergeMap,
  tap,
} from 'rxjs/operators';

import * as CacheActions from '../actions/cache.actions';
import { CachePersistenceService } from 'src/app/core/services/general/cache/cache-persistence.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

/** Compatibilidade mínima de bootstrap; nunca contém o perfil completo. */
const UID_BOOTSTRAP_KEY = 'currentUserUid';

@Injectable()
export class CacheEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly cachePersistence: CachePersistenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  /**
   * Persiste apenas o que a política legada permitir.
   * O adaptador é a barreira final para chaves privadas conhecidas.
   */
  setCache$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(CacheActions.setCache),
        groupBy((action) => String(action.key ?? '').trim()),
        mergeMap((group$) =>
          group$.pipe(
            auditTime(120),
            mergeMap((action) => {
              const key = String(action.key ?? '').trim();

              return this.cachePersistence
                .setPersistent(key, action.value)
                .pipe(
                  tap(() => {
                    if (key !== UID_BOOTSTRAP_KEY) return;

                    try {
                      localStorage.setItem(
                        UID_BOOTSTRAP_KEY,
                        JSON.stringify(action.value)
                      );
                    } catch {
                      // O UID também é somente compatibilidade best-effort.
                    }
                  }),
                  catchError((error) => {
                    this.report(error, key);
                    return EMPTY;
                  })
                );
            })
          )
        ),
        catchError((error) => {
          this.report(error, 'pipeline');
          return EMPTY;
        })
      ),
    { dispatch: false }
  );

  private report(error: unknown, key: string): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[CacheEffects] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'legacy-cache-effects';
      (wrapped as any).context = {
        operation: 'setCache$',
        keyCategory: this.keyCategory(key),
      };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(wrapped);
    } catch {
      // Cache não deve quebrar a cadeia de effects.
    }
  }

  private keyCategory(key: string): string {
    const normalized = String(key ?? '').trim();
    if (!normalized) return 'empty';
    if (normalized === UID_BOOTSTRAP_KEY) return 'uid-bootstrap';

    const separator = normalized.indexOf(':');
    return separator > 0
      ? normalized.slice(0, separator)
      : 'generic';
  }
}
