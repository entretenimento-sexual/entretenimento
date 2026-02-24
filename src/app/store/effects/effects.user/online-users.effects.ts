// src/app/store/effects/effects.user/online-users.effects.ts
// =============================================================================
// EFEITOS: ONLINE USERS (produto / discovery)
//
// Regras "plataformas grandes":
// - Gate ÚNICO: AccessControlService (política/capacidades)
// - Effect orquestra start/stop determinístico (1 listener ativo no máximo)
// - Cancelamento por gate (switchMap)
// - Store recebe SOMENTE payload serializável (runtimeChecks ON)
// - Erro rico vai para GlobalErrorHandlerService (não para Store)
// - Store recebe IError serializável via toStoreError()
// =============================================================================

import { inject, Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';

import { combineLatest, merge, of } from 'rxjs';
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

import { sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

// ✅ Query correta de presença (READ)
import { UserPresenceQueryService } from '@core/services/data-handling/queries/user-presence.query.service';

// ✅ Gate canônico do produto
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

// ✅ Actions EXISTENTES (não cria online-users.actions.ts)
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

// ✅ Selectors existentes
import {
  selectCurrentUser,
  selectOnlineUsers,
} from '../../selectors/selectors.user/user.selectors';

// -----------------------------------------------------------------------------
// Helpers simples (serializáveis)
// -----------------------------------------------------------------------------
const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

@Injectable()
export class OnlineUsersEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);

  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly access = inject(AccessControlService);

  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  private readonly debug = !environment.production;

  // throttle de notificação (evita spam quando stream falha/retry)
  private lastNotifyAt = 0;

  // ---------------------------------------------------------------------------
  // Gate consolidado (fonte única)
  // ---------------------------------------------------------------------------
  // canRunOnlineUsers$: política completa (inclui rota/registro/emailVerified/etc.)
  // authUid$: uid canônico (AuthSession manda no UID)
  private readonly gate$ = combineLatest([
    this.access.canRunOnlineUsers$,
    this.access.authUid$,
  ]).pipe(
    map(([canRun, uid]) => ({
      canStart: canRun === true && !!uid,
      uid: uid ?? null,
      canRun,
    })),
    distinctUntilChanged((a, b) => a.canStart === b.canStart && a.uid === b.uid),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Debug / Notificação
  // ---------------------------------------------------------------------------
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

  /**
   * Erro:
   * - Store recebe IError serializável (toStoreError)
   * - GlobalErrorHandler recebe erro rico (original/context/extra)
   */
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

  // =============================================================================
  // 1) DRIVER ÚNICO (gate → start/stop + listener realtime)
  // =============================================================================
  onlineUsersDriver$ = createEffect(() =>
    this.gate$.pipe(
      tap((g) => this.dbg('gate → state', g)),

      switchMap((gate) => {
        // Gate caiu: cleanup central via reducer
        if (!gate.canStart) {
          this.dbg('gate=false → STOP (reducer cleanup)');
          return of(stopOnlineUsersListener());
        }

        this.dbg('gate=true → START listener', { uid: gate.uid });

        return merge(
          // marcador (telemetria/estado futuro)
          of(startOnlineUsersListener()),

          // ✅ stream realtime (fonte de verdade): presence query
          this.presenceQuery.getOnlineUsers$().pipe(
            map((users) => this.filterUsersEligibleForExposure(users, gate.uid)),
            map((users) => sanitizeUsersForStore(users)),
            map((users) => loadOnlineUsersSuccess({ users })),

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
          map((users) => this.filterUsersEligibleForExposure(users, gate.uid)),
          map((users) => sanitizeUsersForStore(users)),
          map((users) => loadOnlineUsersSuccess({ users })),

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
        this.store.select(selectOnlineUsers),
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

  // =============================================================================
  // Regras do produto: “exposição” (quem aparece no online)
  // =============================================================================
  private filterUsersEligibleForExposure(
    users: IUserDados[] | null | undefined,
    currentUid: string | null
  ): IUserDados[] {
    const list: IUserDados[] = Array.isArray(users) ? users : [];

    return list.filter((u) => {
      const anyU = u as any;

      const uid = typeof anyU?.uid === 'string' ? anyU.uid : '';
      if (!uid) return false;

      // remove self
      if (currentUid && uid === currentUid) return false;

      // produto: exige emailVerified no doc exposto
      if (anyU?.emailVerified !== true) return false;

      // produto: perfil mínimo (preferencial profileCompleted)
      const profileCompleted = anyU?.profileCompleted === true;

      const hasMinFields =
        typeof anyU?.gender === 'string' && anyU.gender.trim() !== '' &&
        typeof anyU?.estado === 'string' && anyU.estado.trim() !== '' &&
        typeof anyU?.municipio === 'string' && anyU.municipio.trim() !== '';

      if (!(profileCompleted || hasMinFields)) return false;

      // futuro: opt-out de aparecer
      if (this.isVoluntaryInvisible(anyU)) return false;

      return true;
    });
  }

  private isVoluntaryInvisible(_anyUser: any): boolean {
    return false;
  }
}
