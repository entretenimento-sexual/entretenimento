// src/app/store/effects/effects.user/user.effects.ts
// Fluxo oficial Firestore -> runtime current user -> NgRx.
// A equivalência usa o usuário serializado completo para não descartar campos
// novos de billing, lifecycle ou compliance.
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
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
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

@Injectable()
export class UserEffects {
  private readonly UNAVAILABLE_CONFIRM_DELAY_MS = 450;

  constructor(
    private readonly actions$: Actions,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  private canDebug(): boolean {
    return this.privacyDebug.canLog('profile');
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `UserEffects: ${message}`, extra);
  }

  private buildUnavailableAction(uid: string) {
    return setCurrentUserUnavailable({
      error: toStoreError(
        null,
        'Usuário não encontrado.',
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
    if (!current && !incoming) return true;
    if (!current || !incoming) return false;

    try {
      const safeCurrent = sanitizeUserForStore(current);
      const safeIncoming = sanitizeUserForStore(incoming);
      return (
        this.stableSerialize(safeCurrent) ===
        this.stableSerialize(safeIncoming)
      );
    } catch {
      return false;
    }
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.sortSerializableValue(value)) ?? 'null';
  }

  private sortSerializableValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.sortSerializableValue(item));
    }

    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      sorted[key] = this.sortSerializableValue(record[key]);
    }

    return sorted;
  }

  observeUserChanges$ = createEffect(() => {
    const start$ = this.actions$.pipe(
      ofType(observeUserChanges),
      map(({ uid }) => String(uid ?? '').trim() || null),
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

        this.currentUserStore.markUnhydrated();

        try {
          this.currentUserStore.restoreFromCacheForUid(uid);
        } catch {
          // Cache compatível é best-effort.
        }

        if (this.canDebug()) {
          this.dbg('observeUserChanges -> subscribe', {
            uid,
            runtimeSnapshot: this.currentUserStore.getSnapshot(),
          });
        }

        return this.firestoreUserQuery.getUser(uid).pipe(
          distinctUntilChanged((previous, current) =>
            this.areUsersEquivalent(
              (previous as IUserDados | null | undefined) ?? null,
              (current as IUserDados | null | undefined) ?? null
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
            if (user) {
              const safeUser = sanitizeUserForStore(user as IUserDados);
              this.currentUserStore.set(safeUser);

              return from([
                setCurrentUser({ user: safeUser }),
                addUserToState({ user: safeUser }),
              ]);
            }

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
          catchError((errorValue) => {
            const error =
              errorValue instanceof Error
                ? errorValue
                : new Error('UserEffects.observeUserChanges$ error');

            (error as any).silent = true;
            (error as any).skipUserNotification = true;
            (error as any).context = 'UserEffects.observeUserChanges$';
            (error as any).uid = uid;
            (error as any).original = errorValue;

            this.globalErrorHandler.handleError(error);
            this.dbg('observeUserChanges -> error', {
              uid,
              error: errorValue,
            });

            return of(
              setCurrentUserHydrationError({
                error: toStoreError(
                  errorValue,
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

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.firestoreQuery.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map((users) =>
            loadUsersSuccess({ users: sanitizeUsersForStore(users) })
          ),
          catchError((error) =>
            of(
              loadUsersFailure({
                error: toStoreError(
                  error,
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
}
