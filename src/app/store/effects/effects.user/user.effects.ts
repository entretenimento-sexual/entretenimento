// src/app/store/effects/effects.user/user.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import {
  observeUserChanges,
  stopObserveUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  setCurrentUser,
  clearCurrentUser,
  addUserToState,
} from '../../actions/actions.user/user.actions';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUserForStore, sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { from, merge, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  switchMap,
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
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  observeUserChanges$ = createEffect(() => {
    // Driver único: START (uid) ou STOP (null)
    const start$ = this.actions$.pipe(
      ofType(observeUserChanges),
      map(({ uid }) => (uid ?? '').trim() || null),
      filter((uid): uid is string => !!uid)
    );

    const stop$ = this.actions$.pipe(
      ofType(stopObserveUserChanges),
      map(() => null as string | null)
    );

    return merge(start$, stop$).pipe(
      distinctUntilChanged(),
      tap((uid) => this.dbg('observeUserChanges driver', { uid })),

      switchMap((uid) => {
        // STOP: limpa fontes do perfil (service + store)
        if (!uid) {
          this.currentUserStore.clear();
          return of(clearCurrentUser());
        }

        // Best-effort: tenta restaurar rápido do cache (se existir)
        try { this.currentUserStore.restoreFromCache(); } catch { /* noop */ }

        this.dbg('observeUserChanges -> subscribe', { uid });

        return this.firestoreUserQuery.getUser(uid).pipe(
          // evita spam de dispatch; mantém seu padrão atual
          distinctUntilChanged((a, b) => {
            try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
          }),

          tap((user) => this.dbg('user snapshot', { uid, hasUser: !!user })),

          switchMap((user) => {
            if (!user) {
              // doc ausente → limpa perfil (service + store) e registra erro serializável
              this.currentUserStore.clear();

              return from([
                clearCurrentUser(),
                loadUsersFailure({
                  error: toStoreError(
                    null,
                    `Usuário ${uid} não encontrado.`,
                    'UserEffects.observeUserChanges$',
                    { uid }
                  ),
                }),
              ]);
            }

            const safeUser = sanitizeUserForStore(user as IUserDados);

            // ✅ Fonte do PERFIL do app (AccessControl + Sidebar dependem disso)
            this.currentUserStore.set(safeUser);

            // ✅ NgRx: currentUser e (opcional) entities/lista
            return from([
              setCurrentUser({ user: safeUser }),
              addUserToState({ user: safeUser }),
            ]);
          }),

          catchError((err) => {
            const e = err instanceof Error ? err : new Error('UserEffects.observeUserChanges$ error');
            (e as any).silent = true;
            (e as any).context = 'UserEffects.observeUserChanges$';
            (e as any).uid = uid;
            (e as any).original = err;
            this.globalErrorHandler.handleError(e);

            this.dbg('observeUserChanges -> error', { uid, err });

            // Em erro: NÃO limpa sessão; apenas degrada estado do perfil
            this.currentUserStore.clear();

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
        );
      })
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
} // Linha 172, fim UserEffects
/*
- UserEffects é responsável por observar mudanças no perfil do usuário atual (users/{uid}) e carregar listas de usuários.
- Ele é acionado por ações específicas (ex.: observeUserChanges, loadUsers) e interage com os serviços de consulta do Firestore para obter os dados.
- O estado do perfil do usuário é mantido no CurrentUserStoreService, que é a fonte de verdade para o perfil do app.
- O NgRx é usado para refletir esse estado no store global, mas o serviço é o dono real dos dados do perfil.
- O efeito observeUserChanges$ é projetado para ser resiliente: ele tenta restaurar do cache, lida com erros sem quebrar a sessão, e mantém logs detalhados para debug.
*/
