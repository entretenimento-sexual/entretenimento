// src/app/store/effects/effects.user/online-users.effects.ts
// =============================================================================
// EFEITOS: ONLINE USERS (produto / discovery)
//
// Regras:
// - Gate ÚNICO: AccessControlService
// - onlineUsers = espelho da coleção presence
// - usersMap = perfis públicos materializados via discovery
// - join final fica nos selectors
// =============================================================================
import { inject, Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';

import { combineLatest, from, merge, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { AppState } from '../../states/app.state';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { IError } from '@core/interfaces/ierror';

import { sanitizeUserForStore, sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { UserPresenceQueryService } from '@core/services/data-handling/queries/user-presence.query.service';
import { UserDiscoveryQueryService } from '@core/services/data-handling/queries/user-discovery.query.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

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
  addUserToState,
} from '../../actions/actions.user/user.actions';

import {
  selectCurrentUser,
  selectUsersMap,
} from '../../selectors/selectors.user/user.selectors';
import {
  selectGlobalOnlineUsers,
} from '../../selectors/selectors.user/online.selectors';

const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

@Injectable()
export class OnlineUsersEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);

  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly access = inject(AccessControlService);

  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  private readonly debug = !environment.production;
  private lastNotifyAt = 0;

  private readonly gate$ = combineLatest([
    this.access.canRunOnlineUsers$,
    this.access.authUid$,
  ]).pipe(
    tap(([canRunRaw, uid]) => this.dbg('gate sources', {
      canRunRaw,
      canRunRawType: typeof canRunRaw,
      uid,
    })),

    map(([canRunRaw, uid]) => {
      const canRun = canRunRaw === true;
      const cleanUid = (uid ?? '').trim() || null;

      return {
        canStart: canRun && !!cleanUid,
        uid: cleanUid,
        canRun,
      };
    }),

    distinctUntilChanged((a, b) =>
      a.canStart === b.canStart &&
      a.uid === b.uid &&
      a.canRun === b.canRun
    ),

    shareReplay({ bufferSize: 1, refCount: true })
  );

  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[OnlineUsersEffects] ${msg}`, extra ?? '');
  }

  private notifyOnce(msg: string) {
    const now = Date.now();
    if (now - this.lastNotifyAt > 15_000) {
      this.lastNotifyAt = now;
      this.errorNotifier.showError(msg);
    }
  }

  private reportEffectError(
    err: unknown,
    fallbackMsg: string,
    context: string,
    extra?: Record<string, unknown>
  ): IError {
    const storeErr = toStoreError(err, fallbackMsg, context, extra);

    const e = err instanceof Error ? err : new Error(storeErr.message);
    (e as any).silent = true;
    (e as any).context = context;
    (e as any).original = err;
    (e as any).extra = storeErr.extra;

    this.globalErrorHandler.handleError(e);
    this.notifyOnce(storeErr.message);

    return storeErr;
  }

  /**
   * Presença é efêmera:
   * - deduplica
   * - remove self
   * - não tenta decidir elegibilidade final aqui
   */
  private normalizePresenceUsers(
    users: IUserDados[] | null | undefined,
    currentUid: string | null
  ): IUserDados[] {
    const list: IUserDados[] = Array.isArray(users) ? users : [];
    const seen = new Set<string>();

    return list.filter((u) => {
      const uid = (u as any)?.uid;
      if (typeof uid !== 'string' || !uid.trim()) return false;

      const cleanUid = uid.trim();

      if (currentUid && cleanUid === currentUid) return false;
      if (seen.has(cleanUid)) return false;

      seen.add(cleanUid);
      return true;
    });
  }

private safeJsonEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

private shouldUpsertProfile(
  current: IUserDados | null | undefined,
  incoming: IUserDados | null | undefined
): boolean {
  if (!incoming?.uid) return false;
  if (!current) return true;
  return !this.safeJsonEqual(current, incoming);
}

  /**
   * Materializa perfis públicos no usersMap.
   * onlineUsers permanece separado.
   */
private hydrateProfilesForOnlineUsers$(
  presenceUsers: IUserDados[],
  currentUid: string | null
) {
  const normalizedPresence = this.normalizePresenceUsers(presenceUsers, currentUid);
  const uids = normalizedPresence.map((u) => (u.uid ?? '').trim()).filter(Boolean);

  if (!uids.length) {
    return of(loadOnlineUsersSuccess({ users: [] }));
  }

  return this.discoveryQuery.getProfilesByUids$(uids).pipe(
    concatLatestFrom(() => this.store.select(selectUsersMap)),
    switchMap(([profiles, usersMap]) => {
      const profileActions = profiles
        .map((p) => sanitizeUserForStore(p))
        .filter((p) => !!p?.uid)
        .filter((profile) => this.shouldUpsertProfile(usersMap?.[profile.uid], profile))
        .map((profile) => addUserToState({ user: profile }));

      return from([
        ...profileActions,
        loadOnlineUsersSuccess({
          users: sanitizeUsersForStore(normalizedPresence),
        }),
      ]);
    })
  );
}

  // =============================================================================
  // 1) DRIVER ÚNICO (gate → start/stop + listener realtime)
  // =============================================================================
  onlineUsersDriver$ = createEffect(() =>
    this.gate$.pipe(
      tap((g) => this.dbg('gate → state', g)),

      switchMap((gate) => {
        if (!gate.canStart) {
          this.dbg('gate=false → STOP (reducer cleanup)');
          return of(stopOnlineUsersListener());
        }

        this.dbg('gate=true → START listener', { uid: gate.uid });

        return merge(
          of(startOnlineUsersListener()),

          this.presenceQuery.getOnlineUsers$().pipe(
            switchMap((presenceUsers) =>
              this.hydrateProfilesForOnlineUsers$(presenceUsers, gate.uid)
            ),

            finalize(() => this.dbg('realtime listener FINALIZE (unsub)')),

            catchError((err) => {
              const storeErr = this.reportEffectError(
                err,
                'Falha ao ouvir usuários online.',
                'OnlineUsersEffects.realtime',
                { uid: gate.uid ?? undefined }
              );

              return of(
                loadOnlineUsersFailure({ error: storeErr }),
                stopOnlineUsersListener()
              );
            })
          )
        );
      })
    )
  );

  // =============================================================================
  // 2) One-shot (snapshot único) — respeita gate canônico
  // =============================================================================
  loadOnlineUsersOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      concatLatestFrom(() => this.gate$),

      switchMap(([, gate]) => {
        if (!gate?.canStart) {
          this.dbg('once ignorado (gate=false)', gate);
          return of(loadOnlineUsersSuccess({ users: [] }));
        }

        this.dbg('once START', { uid: gate.uid });

        return this.presenceQuery.getOnlineUsersOnce$().pipe(
          switchMap((presenceUsers) =>
            this.hydrateProfilesForOnlineUsers$(presenceUsers, gate.uid)
          ),

          catchError((err) => {
            const storeErr = this.reportEffectError(
              err,
              'Falha ao carregar usuários online.',
              'OnlineUsersEffects.once',
              { uid: gate.uid ?? undefined }
            );
            return of(loadOnlineUsersFailure({ error: storeErr }));
          })
        );
      })
    )
  );

  // =============================================================================
  // 3) Filtro por município (somente UI)
  // =============================================================================
  recomputeFilteredOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess, setCurrentUser, clearCurrentUser, updateUserInState),

      concatLatestFrom(() => [
        this.store.select(selectGlobalOnlineUsers),
        this.store.select(selectCurrentUser),
      ]),

      map(([, onlineUsers, currentUser]) => {
        const municipio = norm((currentUser as any)?.municipio);
        if (!municipio) return setFilteredOnlineUsers({ filteredUsers: [] });

        const list: IUserDados[] = Array.isArray(onlineUsers) ? (onlineUsers as IUserDados[]) : [];

        const filteredUsers = list.filter(
          (u: IUserDados) => norm((u as any)?.municipio) === municipio
        );

        return setFilteredOnlineUsers({ filteredUsers });
      }),

      catchError((err) => {
        this.reportEffectError(
          err,
          'Falha ao filtrar usuários online por município.',
          'OnlineUsersEffects.filter'
        );
        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );
} // Linha 318, fim do OnlineUsersEffects
