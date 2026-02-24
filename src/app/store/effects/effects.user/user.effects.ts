// src/app/store/effects/effects.user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import {
  observeUserChanges,
  stopObserveUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
} from '../../actions/actions.user/user.actions';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUserForStore, sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  switchMap,
  takeUntil,
  tap,
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
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  observeUserChanges$ = createEffect(() => {
    const stop$ = this.actions$.pipe(ofType(stopObserveUserChanges));

    return this.actions$.pipe(
      ofType(observeUserChanges),
      map(({ uid }) => (uid ?? '').trim()),
      filter(Boolean),
      distinctUntilChanged(),

      tap((uid) => this.dbg('observeUserChanges -> subscribe', { uid })),

      switchMap((uid) =>
        this.firestoreUserQuery.getUser(uid).pipe(
          takeUntil(stop$),

          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),

          tap((user) => this.dbg('user snapshot', { uid, hasUser: !!user })),

          map((user) => {
            if (user) {
              return loadUsersSuccess({ users: [sanitizeUserForStore(user as IUserDados)] });
            }

            return loadUsersFailure({
              error: toStoreError(
                null,
                `Usuário ${uid} não encontrado.`,
                'UserEffects.observeUserChanges$',
                { uid }
              ),
            });
          }),

          catchError((err) => {
            const e = err instanceof Error ? err : new Error('UserEffects.observeUserChanges$ error');
            (e as any).silent = true;
            (e as any).context = 'UserEffects.observeUserChanges$';
            (e as any).uid = uid;
            (e as any).original = err;
            this.globalErrorHandler.handleError(e);

            this.dbg('observeUserChanges -> error', { uid, err });

            return of(
              loadUsersFailure({
                error: toStoreError(
                  err,
                  'Erro desconhecido ao observar usuário.',
                  'UserEffects.observeUserChanges$',
                  { uid }
                ),
              })
            );
          }),

          finalize(() => this.dbg('observeUserChanges -> finalize', { uid }))
        )
      )
    );
  });

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map((users) => loadUsersSuccess({ users: sanitizeUsersForStore(users) })),
          catchError((err) =>
            of(
              loadUsersFailure({
                error: toStoreError(err, 'Falha ao carregar usuários.', 'UserEffects.loadUsers$'),
              })
            )
          )
        )
      )
    )
  );
}
