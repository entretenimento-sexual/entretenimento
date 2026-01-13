// src/app/store/effects/effects.user/online-users.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { AppState } from '../../states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

// ✅ sessão é fonte da verdade
import { authSessionChanged } from '../../actions/actions.user/auth.actions';
import { selectAuthUid, selectAuthReady } from '../../selectors/selectors.user/auth.selectors';

// ✅ actions “online users”
import {
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  setFilteredOnlineUsers,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setCurrentUser,
  clearCurrentUser,
  updateUserInState,
} from '../../actions/actions.user/user.actions';

// ✅ selectors
import { selectCurrentUser, selectOnlineUsers } from '../../selectors/selectors.user/user.selectors';

/* ============================================================================
  Helpers puros: manter estado/actions serializáveis (runtimeChecks ON)
============================================================================ */

type AnyDateLike = import('firebase/firestore').Timestamp | Date | number | null | undefined;

const toEpoch = (v: AnyDateLike): number | null => {
  if (v == null) return null;
  if (typeof v === 'object' && typeof (v as any).toMillis === 'function') return (v as any).toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};

const serializeUser = (u: IUserDados): IUserDados =>
({
  ...u,
  lastLogin: toEpoch(u.lastLogin) ?? 0,
  firstLogin: toEpoch(u.firstLogin),
  createdAt: toEpoch(u.createdAt),

  singleRoomCreationRightExpires: toEpoch(u.singleRoomCreationRightExpires as any),
  roomCreationSubscriptionExpires: toEpoch(u.roomCreationSubscriptionExpires as any),
  subscriptionExpires: toEpoch(u.subscriptionExpires as any),

  lastSeen: toEpoch(u.lastSeen as any),
  updatedAt: toEpoch((u as any).updatedAt),
  lastOfflineAt: toEpoch(u.lastOfflineAt as any),
  lastOnlineAt: toEpoch(u.lastOnlineAt as any),
  lastLocationAt: toEpoch(u.lastLocationAt as any),
  registrationDate: toEpoch(u.registrationDate as any),
} as IUserDados);

type SerializableError = { message: string; code?: string };

const toSerializableError = (err: unknown, fallbackMsg: string): SerializableError => {
  const anyErr = err as any;
  const message =
    (typeof anyErr?.message === 'string' && anyErr.message) ||
    (typeof anyErr === 'string' && anyErr) ||
    fallbackMsg;

  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
  return code ? { message, code } : { message };
};

const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

/* ============================================================================
  Effects
============================================================================ */

@Injectable()
export class OnlineUsersEffects {
  private readonly debug = !environment.production;

  constructor(
    private readonly actions$: Actions,
    private readonly store: Store<AppState>,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /**
   * ✅ Sessão mudou => liga/desliga listener de online users.
   * UID vem do AuthSessionSyncEffects → authSessionChanged.
   */
  syncListenerFromAuthSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(authSessionChanged),
      map(({ uid }) => !!uid),
      distinctUntilChanged(),
      map((isAuthed) => (isAuthed ? startOnlineUsersListener() : stopOnlineUsersListener()))
    )
  );

  /**
   * ✅ Listener realtime:
   * - só inicia se auth.ready e uid existirem (evita listeners cedo demais no boot)
   * - cancela com stopOnlineUsersListener()
   */
  onlineUsersListener$ = createEffect(() =>
    this.actions$.pipe(
      ofType(startOnlineUsersListener),
      concatLatestFrom(() => [
        this.store.select(selectAuthReady),
        this.store.select(selectAuthUid),
      ]),
      switchMap(([, ready, uid]) => {
        if (!ready || !uid) {
          return of(
            loadOnlineUsersSuccess({ users: [] }),
            setFilteredOnlineUsers({ filteredUsers: [] }),
            stopOnlineUsersListener()
          );
        }

        if (this.debug) console.log('[OnlineUsersEffects] realtime listener START', { uid });

        return this.firestoreQuery.getOnlineUsers$().pipe(
          map((users) => (users ?? []).map(serializeUser)),
          tap((users) => {
            if (this.debug) console.log('[OnlineUsersEffects] realtime onlineUsers =>', users.length);
          }),
          map((users) => loadOnlineUsersSuccess({ users })),

          takeUntil(
            this.actions$.pipe(
              ofType(stopOnlineUsersListener),
              tap(() => {
                if (this.debug) console.log('[OnlineUsersEffects] realtime listener STOP (takeUntil)');
              })
            )
          ),

          catchError((err) => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error(toSerializableError(err, 'Falha ao ouvir usuários online.').message)
            );

            return of(
              loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao ouvir usuários online.') }),
              stopOnlineUsersListener()
            );
          })
        );
      })
    )
  );

  /**
   * ✅ Compat “once”:
   * - se estiver deslogado / não-ready, não chama Firestore
   * - se logado, snapshot único
   */
  loadOnlineUsersOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      concatLatestFrom(() => [
        this.store.select(selectAuthReady),
        this.store.select(selectAuthUid),
      ]),
      switchMap(([, ready, uid]) => {
        if (!ready || !uid) {
          if (this.debug) console.log('[OnlineUsersEffects] loadOnlineUsers (once) ignorado', { ready, uid });
          return of(loadOnlineUsersSuccess({ users: [] }));
        }

        if (this.debug) console.log('[OnlineUsersEffects] loadOnlineUsers (once) START', { uid });

        return this.firestoreQuery.getOnlineUsers().pipe(
          map((users) => (users ?? []).map(serializeUser)),
          map((users) => loadOnlineUsersSuccess({ users })),
          catchError((err) => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error(toSerializableError(err, 'Falha ao carregar usuários online.').message)
            );
            return of(loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao carregar usuários online.') }));
          })
        );
      })
    )
  );

  /**
   * ✅ Filtro por município (somente UI):
   * - recalcula quando onlineUsers muda OU quando usuário atual muda
   */
  recomputeFilteredOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess, setCurrentUser, clearCurrentUser, updateUserInState),
      concatLatestFrom(() => [
        this.store.select(selectOnlineUsers),
        this.store.select(selectCurrentUser),
      ]),
      map(([, onlineUsers, currentUser]) => {
        const municipio = norm(currentUser?.municipio);
        if (!municipio) return setFilteredOnlineUsers({ filteredUsers: [] });

        // ✅ tipa localmente para evitar implicit-any no callback do filter
        const list: IUserDados[] = Array.isArray(onlineUsers) ? (onlineUsers as IUserDados[]) : [];

        const filteredUsers = list.filter((u: IUserDados) => norm(u?.municipio) === municipio);
        return setFilteredOnlineUsers({ filteredUsers });
      }),
      catchError((err) => {
        this.globalErrorHandler.handleError(
          err instanceof Error ? err : new Error('Falha ao filtrar usuários online por município.')
        );
        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );

  /**
   * ✅ Ao parar o listener (logout/stop), garante UI limpa.
   */
  clearFilteredOnStop$ = createEffect(() =>
    this.actions$.pipe(
      ofType(stopOnlineUsersListener),
      map(() => setFilteredOnlineUsers({ filteredUsers: [] }))
    )
  );
}
