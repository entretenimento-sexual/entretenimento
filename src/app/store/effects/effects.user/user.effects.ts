// Efeitos relacionados a usuários, como carregar dados de usuários e observar mudanças em tempo real.
// src/app/store/effects/effects.user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  observeUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure
} from '../../actions/actions.user/user.actions';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUserForStore, sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';

import { EMPTY, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  tap,
  finalize
} from 'rxjs/operators';

import { environment } from 'src/environments/environment';

@Injectable()
export class UserEffects {
  private readonly debug = !environment.production;

  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[UserEffects] ${msg}`, extra ?? '');
  }

  constructor(
    private readonly actions$: Actions,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly firestoreUserQuery: FirestoreUserQueryService
  ) { }

  /**
   * ✅ Observa mudanças do usuário no Firestore (realtime) e projeta para o Store.
   * - NÃO assina Store aqui (evita loop).
   * - switchMap cancela o listener anterior se outro uid chegar.
   */
  observeUserChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(observeUserChanges),
      map(({ uid }) => (uid ?? '').trim()),
      filter(Boolean),
      distinctUntilChanged(),

      tap((uid) => this.dbg('observeUserChanges -> subscribe', { uid })),

      switchMap((uid) =>
        this.firestoreUserQuery.getUser(uid).pipe(
          // ✅ evita dispatch repetido se o repo emitir o mesmo objeto / mesmos dados
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),

          tap(user => this.dbg('user snapshot', { uid, hasUser: !!user })),

          map((user) => {
            if (user) {
              return loadUsersSuccess({ users: [sanitizeUserForStore(user as IUserDados)] });
            }
            return loadUsersFailure({ error: { message: `Usuário ${uid} não encontrado.` } });
          }),

          catchError((error) => {
            this.dbg('observeUserChanges -> error', { uid, error });
            return of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }));
          }),

          finalize(() => this.dbg('observeUserChanges -> finalize', { uid }))
        )
      )
    )
  );

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map((users) => loadUsersSuccess({ users: sanitizeUsersForStore(users) })),
          catchError((error) =>
            of(loadUsersFailure({ error: { message: error?.message || 'Erro desconhecido.' } }))
          )
        )
      )
    )
  );
} // Linha 99
