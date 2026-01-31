//src\app\store\effects\cache.effects.ts
// Efeito NgRx para persistência de cache no IndexedDB
// Não esquecer os comentários
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { EMPTY } from 'rxjs';
import { auditTime, catchError, groupBy, mergeMap, tap } from 'rxjs/operators';

import * as CacheActions from '../actions/cache.actions';
import { CachePersistenceService } from 'src/app/core/services/general/cache/cache-persistence.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

const HOT_KEYS: ReadonlySet<string> = new Set(['currentUser', 'currentUserUid']);

@Injectable()
export class CacheEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly cachePersistence: CachePersistenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) { }

  /**
   * Persiste o cache no IndexedDB (não reescreve no CacheService para evitar storm/loop).
   * Debounce por chave para reduzir escrita em rajadas (ex.: abertura do perfil).
   */
  setCache$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(CacheActions.setCache),

        // Debounce por key para não martelar o IndexedDB
        groupBy(a => (a.key ?? '').trim()),
        mergeMap(group$ =>
          group$.pipe(
            auditTime(120), // ajuste fino: 80~250ms costuma ficar ótimo
            mergeMap(action =>
              this.cachePersistence.setPersistent((action.key ?? '').trim(), action.value).pipe(
                tap(() => {
                  // Hot keys: espelho para leitura síncrona em bootstrap (se vierem via action)
                  const k = (action.key ?? '').trim();
                  if (HOT_KEYS.has(k)) {
                    try { localStorage.setItem(k, JSON.stringify(action.value)); } catch { }
                  }
                }),
                catchError(err => {
                  // Tratamento centralizado
                  try { this.globalErrorHandler.handleError(err); } catch { }
                  try { this.notifier.showError('Falha ao persistir cache local.'); } catch { }
                  console.error('[CacheEffects] setCache$ erro:', action.key, err);
                  return EMPTY;
                })
              )
            )
          )
        ),

        catchError(err => {
          // fallback global (não deve ocorrer com catch interno, mas fica seguro)
          try { this.globalErrorHandler.handleError(err); } catch { }
          try { this.notifier.showError('Erro inesperado no CacheEffects.'); } catch { }
          console.error('[CacheEffects] pipeline erro:', err);
          return EMPTY;
        })
      ),
    { dispatch: false }
  );
}
/*
AuthSession (UID + claims + emailVerified + ready) = mínimo e estável
CurrentUser (IUserDados) = documento/visão de perfil
Presence = efêmero/realtime, gated por AuthSession
Persistência local: actions → effect persiste (IndexedDB/localStorage), e o service não regrava tudo duas vezes
*/
