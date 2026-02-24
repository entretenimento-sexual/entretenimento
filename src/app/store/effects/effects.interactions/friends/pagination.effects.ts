// src/app/store/effects/effects.interactions/friends/pagination.effects.ts
// Não esquecer comentários e ferramentas de debug
// Efeitos de paginação da lista de amigos
// - ✅ loadFirstOrRefresh: carrega a primeira página ou recarrega (replace)
// - ✅ loadNext: carrega a próxima página (append)
import { Injectable, inject, isDevMode } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { concatLatestFrom } from '@ngrx/operators';

import { of } from 'rxjs';
import { catchError, filter, map, switchMap, exhaustMap, tap } from 'rxjs/operators';

import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectFriendsPageLoading,
  selectFriendsPageNextOrder,
  selectFriendsPageReachedEnd,
} from '../../../selectors/selectors.interactions/friends/pagination.selectors';

import { toEpoch } from 'src/app/store/utils/user-store.serializer';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable()
export class FriendsPaginationEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly svc = inject(FriendshipService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  // ---------------------------------------------------------------------------
  // Debug (habilitado só em dev)
  // ---------------------------------------------------------------------------
  private readonly debugEnabled = isDevMode(); // ou amarre em environment.flag se preferir

  private debug(label: string, data?: Record<string, unknown>): void {
    if (!this.debugEnabled) return;
    // eslint-disable-next-line no-console
    console.debug(`[FriendsPaginationEffects] ${label}`, data ?? {});
  }

  /** normaliza cursor para Store: number | null (epoch) */
  private normalizeCursor(v: unknown): number | null {
    // aceita number | Timestamp | Date | null
    const epoch = toEpoch(v as any);
    return typeof epoch === 'number' ? epoch : null; // garante contract number|null
  }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[FriendsPaginationEffects] listFriendsPage failed');
      (e as any).feature = 'friends-pagination';
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { /* noop */ }
  }

  /** First + Refresh (replace) */
  loadFirstOrRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsFirstPage, P.refreshFriendsPage),

      // evita query com uid inválido
      filter(({ uid }) => !!(uid ?? '').trim()),

      tap(({ uid, pageSize }) => this.debug('first-or-refresh:action', { uid, pageSize })),

      // switchMap aqui faz sentido: refresh cancela a anterior (última intenção vence)
      switchMap(({ uid, pageSize }) => {
        const size = pageSize ?? 24;

        return this.svc.listFriendsPage(uid, size, null).pipe(
          tap(({ items, nextAfter, reachedEnd }) =>
            this.debug('first-or-refresh:svc:ok', {
              uid,
              size,
              items: items?.length ?? 0,
              nextAfterEpoch: this.normalizeCursor(nextAfter),
              reachedEnd,
            })
          ),
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid,
              items,
              // ✅ Store sempre epoch
              nextOrderValue: this.normalizeCursor(nextAfter),
              reachedEnd,
              append: false,
            })
          ),
          catchError((err) => {
            this.report(err, { step: 'first-or-refresh', uid, pageSize: size });
            this.debug('first-or-refresh:svc:error', { uid, size, err: String((err as any)?.message ?? err) });
            return of(P.loadFriendsPageFailure({ uid, error: String((err as any)?.message ?? err) }));
          })
        );
      })
    )
  );

  /** Next page (append) */
  loadNext$ = createEffect(() =>
    this.actions$.pipe(
      ofType(P.loadFriendsNextPage),

      tap(({ uid, pageSize }) => this.debug('next:action', { uid, pageSize })),

      // pega os 3 pedaços do store diretamente (sem reemitir action)
      concatLatestFrom((action) => [
        this.store.select(selectFriendsPageLoading(action.uid)),
        this.store.select(selectFriendsPageReachedEnd(action.uid)),
        this.store.select(selectFriendsPageNextOrder(action.uid)),
      ]),

      // se já está carregando ou já acabou, não faz nada
      filter(([action, loading, reachedEnd]) => {
        const uidOk = !!(action.uid ?? '').trim();
        const canRun = uidOk && !loading && !reachedEnd;
        if (!canRun) {
          // útil pra diagnosticar "scroll chamando demais"
          // (não é erro; é comportamento esperado)
          // log somente em dev
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          this.debugEnabled && this.debug('next:skipped', { uid: action.uid, loading, reachedEnd });
        }
        return canRun;
      }),

      // IMPORTANTe:
      // - exhaustMap evita cancelamento da página em voo (switchMap poderia cancelar)
      // - com seu "loading" no store, isso vira um “filtro + trava” robusto
      exhaustMap(([action, _loading, _reachedEnd, nextOrderValue]) => {
        const afterEpoch = this.normalizeCursor(nextOrderValue); // ✅ number|null
        const size = action.pageSize ?? 24;

        this.debug('next:svc:call', { uid: action.uid, size, afterEpoch });

        return this.svc.listFriendsPage(action.uid, size, afterEpoch).pipe(
          tap(({ items, nextAfter, reachedEnd }) =>
            this.debug('next:svc:ok', {
              uid: action.uid,
              size,
              items: items?.length ?? 0,
              nextAfterEpoch: this.normalizeCursor(nextAfter),
              reachedEnd,
            })
          ),
          map(({ items, nextAfter, reachedEnd }) =>
            P.loadFriendsPageSuccess({
              uid: action.uid,
              items,
              nextOrderValue: this.normalizeCursor(nextAfter),
              reachedEnd,
              append: true,
            })
          ),
          catchError((err) => {
            this.report(err, { step: 'next', uid: action.uid, pageSize: size, afterEpoch });
            this.debug('next:svc:error', { uid: action.uid, size, afterEpoch, err: String((err as any)?.message ?? err) });
            return of(P.loadFriendsPageFailure({ uid: action.uid, error: String((err as any)?.message ?? err) }));
          })
        );
      })
    )
  );
}
