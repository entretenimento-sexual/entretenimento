// src/app/store/effects/effects.user/user.effects.ts
// Considera a arquitetura completa do projeto:
// - AuthSessionService = fonte da sessão
// - CurrentUserStoreService = runtime tri-state do current user
// - NgRx = espelho global / serializável
//
// Ajuste principal deste patch:
// - não transformar o primeiro snapshot vazio em "indisponível" imediatamente
// - manter undefined (hidratação em andamento) durante uma pequena janela de confirmação
// - se o usuário chegar antes, o switchMap cancela o timer automaticamente
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
  setCurrentUserUnavailable,
  setCurrentUserHydrationError,
} from '../../actions/actions.user/user.actions';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  sanitizeUserForStore,
  sanitizeUsersForStore,
} from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { from, merge, of, timer } from 'rxjs';
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

  /**
   * Janela curta para confirmar ausência real do doc.
   *
   * Motivo:
   * - evita "hasUser:false -> setUnavailable() -> hasUser:true" durante bootstrap
   * - mantém o runtime em undefined enquanto o primeiro snapshot estabiliza
   *
   * Observação:
   * - se o usuário chegar antes desse prazo, o switchMap cancela este timer
   * - isso mantém o fluxo 100% reativo, sem setTimeout imperativo espalhado
   */
  private readonly UNAVAILABLE_CONFIRM_DELAY_MS = 450;

  private dbg(msg: string, extra?: unknown): void {
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
  ) {}


  private buildUnavailableAction(uid: string) {
    return setCurrentUserUnavailable({
      error: toStoreError(
        null,
        `Usuário ${uid} não encontrado.`,
        'UserEffects.observeUserChanges$',
        { uid }
      ),
    });
  }

  private areUsersEquivalent(
  current: IUserDados | null | undefined,
  incoming: IUserDados | null | undefined
): boolean {
  if (current === incoming) return true;
  if (!current || !incoming) return false;

  return (
    current.uid === incoming.uid &&
    current.nickname === incoming.nickname &&
    current.email === incoming.email &&
    current.emailVerified === incoming.emailVerified &&
    current.role === incoming.role &&
    current.profileCompleted === incoming.profileCompleted
  );
}

  /**
   * Observa o documento users/{uid}.
   *
   * Regras:
   * - UID vem do bridge AuthSession -> NgRx
   * - STOP limpa runtime e store global
   * - START tenta restore rápido do cache compatível
   * - doc ausente não vira unavailable imediatamente; primeiro passa por uma janela curta de confirmação
   * - erro de stream => hydration error (não derruba sessão)
   */
  observeUserChanges$ = createEffect(() => {
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
        if (!uid) {
          this.currentUserStore.clear();
          return of(clearCurrentUser());
        }

        /**
         * Ao iniciar um novo UID:
         * - marca runtime como "hidratação em andamento"
         * - tenta restore rápido do cache compatível
         *
         * Importante:
         * - mesmo que restore não ache nada, ainda não concluímos "indisponível"
         * - essa conclusão fica para a janela curta de confirmação abaixo
         */
        this.currentUserStore.markUnhydrated();

        try {
          this.currentUserStore.restoreFromCacheForUid(uid);
        } catch {
          // noop
        }

        this.dbg('observeUserChanges -> subscribe', {
          uid,
          runtimeSnapshot: this.currentUserStore.getSnapshot(),
        });

        return this.firestoreUserQuery.getUser(uid).pipe(
          distinctUntilChanged((a, b) =>
            this.areUsersEquivalent(
              (a as IUserDados | null | undefined) ?? null,
              (b as IUserDados | null | undefined) ?? null
            )
          ),

          tap((user) =>
            this.dbg('user snapshot', {
              uid,
              hasUser: !!user,
              kind: user ? 'user' : 'empty',
            })
          ),

          switchMap((user) => {
            /**
             * Snapshot válido:
             * - normaliza
             * - atualiza runtime store
             * - atualiza NgRx
             */
            if (user) {
              const safeUser = sanitizeUserForStore(user as IUserDados);

              this.currentUserStore.set(safeUser);

              return from([
                setCurrentUser({ user: safeUser }),
                addUserToState({ user: safeUser }),
              ]);
            }

            /**
             * Snapshot vazio:
             * - NÃO concluímos indisponibilidade imediatamente
             * - aguardamos uma pequena janela
             * - se um user real chegar antes, este timer é cancelado pelo switchMap
             */
            return timer(this.UNAVAILABLE_CONFIRM_DELAY_MS).pipe(
              tap(() => {
                this.dbg('user snapshot -> confirmed unavailable', {
                  uid,
                  delayMs: this.UNAVAILABLE_CONFIRM_DELAY_MS,
                });

                this.currentUserStore.setUnavailable();
              }),
              map(() => this.buildUnavailableAction(uid))
            );
          }),

          catchError((err) => {
            const error =
              err instanceof Error
                ? err
                : new Error('UserEffects.observeUserChanges$ error');

            (error as any).silent = true;
            (error as any).skipUserNotification = true;
            (error as any).context = 'UserEffects.observeUserChanges$';
            (error as any).uid = uid;
            (error as any).original = err;

            this.globalErrorHandler.handleError(error);
            this.dbg('observeUserChanges -> error', { uid, err });

            /**
             * Em erro de hidratação:
             * - não derrubamos a sessão
             * - não forçamos unavailable imediatamente
             * - apenas marcamos erro serializável no store
             *
             * Motivo:
             * - indisponibilidade e erro de stream são estados diferentes
             * - erro transitório não deve apagar runtime válido sem necessidade
             */
            return of(
              setCurrentUserHydrationError({
                error: toStoreError(
                  err,
                  'Erro desconhecido ao observar usuário.',
                  'UserEffects.observeUserChanges$',
                  { uid }
                ),
              })
            );
          }),

          finalize(() =>
            this.dbg('observeUserChanges -> finalize', { uid })
          )
        );
      })
    );
  });

  /**
   * Lista geral de usuários.
   * Separada do fluxo do currentUser.
   */
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map((users) =>
            loadUsersSuccess({ users: sanitizeUsersForStore(users) })
          ),
          catchError((err) =>
            of(
              loadUsersFailure({
                error: toStoreError(
                  err,
                  'Falha ao carregar usuários.',
                  'UserEffects.loadUsers$'
                ),
              })
            )
          )
        )
      )
    )
  );
} // Linha 277, fim do user.effects.ts
