// src/app/store/effects/user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  observeUserChanges, loadUsers, loadUsersSuccess, loadUsersFailure, loadOnlineUsers,
  loadOnlineUsersSuccess, loadOnlineUsersFailure
} from '../../actions/actions.user/user.actions';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { catchError, map, switchMap, of, from } from 'rxjs';
import { Store, select } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { selectUserById } from '../../selectors/selectors.user/user.selectors';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// ⬇️ Helpers de serialização (garante number para datas)
type AnyDateLike = import('firebase/firestore').Timestamp | Date | number | null | undefined;
const toEpoch = (v: AnyDateLike): number | null => {
  if (v == null) return null;
  if (typeof v === 'object' && typeof (v as any).toMillis === 'function') return (v as any).toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};
const serializeUser = (u: IUserDados) =>
({
  ...u,
  lastLogin: toEpoch(u.lastLogin) ?? 0,
  firstLogin: toEpoch(u.firstLogin),
  createdAt: toEpoch(u.createdAt),
  singleRoomCreationRightExpires: toEpoch(u.singleRoomCreationRightExpires as any),
  roomCreationSubscriptionExpires: toEpoch(u.roomCreationSubscriptionExpires as any),
  subscriptionExpires: toEpoch(u.subscriptionExpires as any),
} as unknown as IUserDados);

@Injectable()
export class UserEffects {
  constructor(
    private actions$: Actions,
    private firestoreQuery: FirestoreQueryService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private store: Store<AppState>
  ) { }

  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      switchMap(({ uid }) =>
        this.store.pipe(
          select(selectUserById(uid)),
          switchMap(existingUser => {
            if (existingUser) return of(loadUsersSuccess({ users: [serializeUser(existingUser)] }));
            return this.firestoreUserQuery.getUser(uid).pipe(
              map(user =>
                user
                  ? loadUsersSuccess({ users: [serializeUser(user as IUserDados)] })
                  : loadUsersFailure({ error: { message: `Usuário ${uid} não encontrado.` } })
              ),
              catchError(error => of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } })))
            );
          })
        )
      )
    )
  );

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        from(this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', [])).pipe(
          map(users => loadUsersSuccess({ users: (users || []).map(serializeUser) })),
          catchError(error => of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } })))
        )
      )
    )
  );

  loadOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      switchMap(() =>
        this.firestoreQuery.getOnlineUsers().pipe(
          map((users: IUserDados[]) => loadOnlineUsersSuccess({ users: (users || []).map(serializeUser) })),
          catchError(error => of(loadOnlineUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } })))
        )
      )
    )
  );
}
