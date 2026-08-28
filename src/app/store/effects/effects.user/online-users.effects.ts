// src/app/store/effects/effects.user/online-users.effects.ts
// =============================================================================
// EFEITOS: ONLINE USERS
// =============================================================================
//
// Responsabilidade:
// - iniciar/parar listener de usuários online conforme gate canônico;
// - ouvir presence/{uid} em tempo real;
// - buscar public_profiles dos UIDs presentes;
// - montar onlineUsers com perfis públicos já enriquecidos por presença;
// - manter usersMap atualizado com o recorte público necessário ao card;
// - recalcular filteredUsers apenas como recorte auxiliar de UI.
//
// Regras de arquitetura:
// - presence define QUEM está online e o estado efêmero;
// - public_profiles define QUAL perfil pode ser exibido publicamente;
// - onlineUsers recebe perfis públicos hidratados com presence;
// - usersMap recebe perfis públicos materializados;
// - filteredUsers não deve ser fonte do modo "Online" geral.
//
// Segurança:
// - presence nunca apaga dados públicos persistentes;
// - não expõe e-mail, telefone ou dados privados;
// - erros passam pelo GlobalErrorHandlerService;
// - notificação ao usuário é limitada para evitar spam.
//
// Manutenção:
// - helpers pequenos e reaproveitáveis;
// - nenhum método duplicado;
// - sem effect temporário de debug;
// - compatível com fluxo atual NgRx sem criar reducer novo.
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

import { AppState } from '../../states/app.state';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';

import { UserPresenceQueryService } from '@core/services/data-handling/queries/user-presence.query.service';
import { UserDiscoveryQueryService } from '@core/services/data-handling/queries/user-discovery.query.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

import {
  loadOnlineUsers,
  loadOnlineUsersFailure,
  loadOnlineUsersSuccess,
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
import { OnlineUsersProfileHydrationService } from './online-users-profile-hydration.service';
import { OnlineUsersProfileComparatorService } from './online-users-profile-comparator.service';
import { OnlineUsersEffectFeedbackService } from './online-users-effect-feedback.service';

const norm = (value?: string | null): string =>
  (value ?? '').trim().toLowerCase();

@Injectable()
export class OnlineUsersEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);

  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly access = inject(AccessControlService);
  private readonly profileHydration = inject(OnlineUsersProfileHydrationService);
  private readonly profileComparator = inject(OnlineUsersProfileComparatorService);
  private readonly feedback = inject(OnlineUsersEffectFeedbackService);

  /**
   * Gate canônico da feature online.
   *
   * O listener só roda quando:
   * - o app pode executar;
   * - existe UID autenticado;
   * - o AccessControlService libera a feature de usuários online.
   */
  private readonly gate$ = combineLatest([
    this.access.canRunOnlineUsers$,
    this.access.authUid$,
  ]).pipe(
    tap(([canRunRaw, uid]) =>
      this.feedback.debug('gate sources', {
        canRunRaw,
        canRunRawType: typeof canRunRaw,
        uid,
      })
    ),

    map(([canRunRaw, uid]) => {
      const canRun = canRunRaw === true;
      const cleanUid = this.profileComparator.toCleanText(uid);

      return {
        canStart: canRun && !!cleanUid,
        uid: cleanUid,
        canRun,
      };
    }),

    distinctUntilChanged(
      (a, b) =>
        a.canStart === b.canStart &&
        a.uid === b.uid &&
        a.canRun === b.canRun
    ),

    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ===========================================================================
  // Normalização do public_profile para o card online
  // ===========================================================================

  /**
   * Hidrata usuários online a partir de:
   * - presence: quem está online;
   * - public_profiles: dados públicos do card.
   *
   * Saída:
   * - addUserToState/updateUserInState para materializar usersMap;
   * - loadOnlineUsersSuccess com perfis públicos já hidratados com presence.
   *
   * Ponto crítico:
   * loadOnlineUsersSuccess deve receber hydratedOnlineUsers,
   * não normalizedPresence.
   */
  private hydrateProfilesForOnlineUsers$(
    presenceUsers: IUserDados[],
    currentUid: string | null
  ) {
const normalizedPresence = this.profileComparator.normalizePresenceUsers(
  presenceUsers,
  currentUid
);

    const presenceByUid = new Map<string, IUserDados>();

    for (const presence of normalizedPresence) {
      const uid = this.profileComparator.toCleanText(presence.uid);

      if (uid) {
        presenceByUid.set(uid, presence);
      }
    }

    const uids = normalizedPresence
      .map((user) => this.profileComparator.toCleanText(user.uid))
      .filter((uid): uid is string => !!uid);

    if (!uids.length) {
      return of(loadOnlineUsersSuccess({ users: [] }));
    }

    return this.discoveryQuery
      .getProfilesByUids$(uids, { cacheTTL: 5_000 })
      .pipe(
        concatLatestFrom(() => this.store.select(selectUsersMap)),

        switchMap(([profiles, usersMap]) => {
          const publicProfiles = (profiles ?? [])
            .map((profile) => this.profileHydration.normalizePublicProfileForOnline(profile))
            .filter((profile): profile is IUserDados => !!profile?.uid);

          const hydratedOnlineUsers = publicProfiles
            .map((profile) => {
              const uid = this.profileComparator.toCleanText(profile.uid);
              const presence = uid ? presenceByUid.get(uid) : null;

              return this.profileHydration.mergePresenceIntoPublicProfile(profile, presence);
            })
            .filter((user): user is IUserDados => !!user?.uid);

          const profileActions = publicProfiles
            .filter((profile) =>
              this.profileComparator.shouldUpsertProfile(usersMap?.[profile.uid], profile)
            )
            .map((profile) => {
              const current = usersMap?.[profile.uid];

              return current
                ? updateUserInState({
                    uid: profile.uid,
                    updatedData: profile,
                  })
                : addUserToState({ user: profile });
            });

          if (this.feedback.canDebug()) {
            this.feedback.debug('hydrateProfilesForOnlineUsers$', {
              presenceTotal: normalizedPresence.length,
              profilesTotal: publicProfiles.length,
              hydratedOnlineTotal: hydratedOnlineUsers.length,
              profileActionsTotal: profileActions.length,

              /**
               * Mantém uids apenas no modo debug opt-in.
               * O PrivacyDebugLoggerService mascara os valores.
               */
              uids,

              /**
               * Não logamos localização precisa.
               * Para debug do card, basta saber se os campos existem.
               */
              hydrated: hydratedOnlineUsers.map((profile) => ({
                uid: profile.uid,
                hasNickname: !!profile.nickname,
                isOnline: (profile as any).isOnline,
                presenceState: (profile as any).presenceState,
                hasCoordinates:
                  typeof (profile as any).latitude === 'number' &&
                  typeof (profile as any).longitude === 'number',
                hasGeohash: !!(profile as any).geohash,
                hasGender: !!(profile as any).gender,
                hasOrientation: !!(profile as any).orientation,
                hasLocation: !!(profile as any).estado || !!(profile as any).municipio,
                role: (profile as any).role,
              })),
            });
          }

          return from([
            ...profileActions,

            /**
             * onlineUsers recebe perfis públicos hidratados com presença.
             */
            loadOnlineUsersSuccess({
              users: sanitizeUsersForStore(hydratedOnlineUsers),
            }),
          ]);
        })
      );
  }

  // ===========================================================================
  // 1) Driver único: gate → start/stop + listener realtime
  // ===========================================================================

  onlineUsersDriver$ = createEffect(() =>
    this.gate$.pipe(
      tap((gate) => this.feedback.debug('gate → state', gate)),

      switchMap((gate) => {
        if (!gate.canStart) {
          this.feedback.debug('gate=false → STOP (reducer cleanup)');
          return of(stopOnlineUsersListener());
        }

        this.feedback.debug('gate=true → START listener', { uid: gate.uid });

        return merge(
          of(startOnlineUsersListener()),

this.presenceQuery.getOnlineUsers$().pipe(
  map((presenceUsers) => ({
    presenceUsers,
fingerprint: this.profileComparator.buildPresenceFingerprint(
  presenceUsers,
  gate.uid
),
  })),

  distinctUntilChanged(
    (previous, current) => previous.fingerprint === current.fingerprint
  ),

tap(({ presenceUsers, fingerprint }) =>
  this.feedback.debug('presence emission accepted', {
    uid: gate.uid,
    fingerprintLength: fingerprint.length,
    total: Array.isArray(presenceUsers) ? presenceUsers.length : 0,
  })
),

  switchMap(({ presenceUsers }) =>
    this.hydrateProfilesForOnlineUsers$(presenceUsers, gate.uid)
  ),

  finalize(() =>
    this.feedback.debug('realtime listener FINALIZE (unsub)')
  ),

  catchError((err) => {
    const storeErr = this.feedback.reportEffectError(
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

  // ===========================================================================
  // 2) Snapshot único: loadOnlineUsers
  // ===========================================================================

  loadOnlineUsersOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),
      concatLatestFrom(() => this.gate$),

      switchMap(([, gate]) => {
        if (!gate?.canStart) {
          this.feedback.debug('once ignorado (gate=false)', gate);
          return of(loadOnlineUsersSuccess({ users: [] }));
        }

        this.feedback.debug('once START', { uid: gate.uid });

        return this.presenceQuery.getOnlineUsersOnce$().pipe(
          switchMap((presenceUsers) =>
            this.hydrateProfilesForOnlineUsers$(presenceUsers, gate.uid)
          ),

          catchError((err) => {
            const storeErr = this.feedback.reportEffectError(
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

  // ===========================================================================
  // 3) Filtro auxiliar por município
  // ===========================================================================

  /**
   * Este filtro é apenas recorte auxiliar de UI.
   *
   * Não deve ser usado como fonte do modo "Online" geral.
   * O modo Online deve consumir selectGlobalOnlineUsers.
   *
   * Futuramente pode alimentar:
   * - Região;
   * - Perto;
   * - recortes locais;
   * - sugestões regionais.
   */
  recomputeFilteredOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        loadOnlineUsersSuccess,
        setCurrentUser,
        clearCurrentUser,
        updateUserInState
      ),

      concatLatestFrom(() => [
        this.store.select(selectGlobalOnlineUsers),
        this.store.select(selectCurrentUser),
      ]),

      map(([, onlineUsers, currentUser]) => {
        const municipio = norm((currentUser as any)?.municipio);

        if (!municipio) {
          return setFilteredOnlineUsers({ filteredUsers: [] });
        }

        const list: IUserDados[] = Array.isArray(onlineUsers)
          ? (onlineUsers as IUserDados[])
          : [];

        const filteredUsers = list.filter(
          (user) => norm((user as any)?.municipio) === municipio
        );

        return setFilteredOnlineUsers({ filteredUsers });
      }),

      catchError((err) => {
        this.feedback.reportEffectError(
          err,
          'Falha ao filtrar usuários online por município.',
          'OnlineUsersEffects.filter'
        );

        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );
} // fim da classe OnlineUsersEffects
