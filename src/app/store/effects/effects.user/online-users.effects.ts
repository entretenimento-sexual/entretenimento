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
import { IError } from '@core/interfaces/ierror';

import { sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';
import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
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

const norm = (value?: string | null): string =>
  (value ?? '').trim().toLowerCase();

@Injectable()
export class OnlineUsersEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);

  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly access = inject(AccessControlService);

  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly profileHydration = inject(OnlineUsersProfileHydrationService);

  private lastNotifyAt = 0;

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
      this.dbg('gate sources', {
        canRunRaw,
        canRunRawType: typeof canRunRaw,
        uid,
      })
    ),

    map(([canRunRaw, uid]) => {
      const canRun = canRunRaw === true;
      const cleanUid = this.toCleanText(uid);

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
  // Logs controlados / erros
  // ===========================================================================
private canDebug(): boolean {
  return this.privacyDebug.canLog('online-users');
}

private dbg(msg: string, extra?: unknown): void {
  this.privacyDebug.log('online-users', msg, extra);
}

  private notifyOnce(msg: string): void {
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

    const error = err instanceof Error ? err : new Error(storeErr.message);

    /**
     * Mantém compatibilidade com o tratamento centralizado já usado no projeto.
     * A notificação ao usuário é controlada por notifyOnce(), evitando spam.
     */
    (error as any).silent = true;
    (error as any).context = context;
    (error as any).original = err;
    (error as any).extra = storeErr.extra;

    this.globalErrorHandler.handleError(error);
    this.notifyOnce(storeErr.message);

    return storeErr;
  }

  // ===========================================================================
  // Normalização básica
  // ===========================================================================

  private toCleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();

    return text.length ? text : null;
  }

  private toOptionalNumber(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(n) ? n : null;
  }

  /**
   * Normaliza presence.
   *
   * Aqui fazemos apenas:
   * - array seguro;
   * - UID válido;
   * - remoção do próprio usuário;
   * - deduplicação.
   *
   * A elegibilidade pública final permanece no selector/utilitário.
   */
  private normalizePresenceUsers(
    users: IUserDados[] | null | undefined,
    currentUid: string | null
  ): IUserDados[] {
    const list = Array.isArray(users) ? users : [];
    const seen = new Set<string>();

    return list.filter((user) => {
      const uid = this.toCleanText((user as any)?.uid);

      if (!uid) {
        return false;
      }

      if (currentUid && uid === currentUid) {
        return false;
      }

      if (seen.has(uid)) {
        return false;
      }

      seen.add(uid);

      return true;
    });
  }

  // ===========================================================================
  // Comparação para evitar updates desnecessários no usersMap
  // ===========================================================================

  private toComparableText(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  private toComparableCoordinate(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(n)) {
      return null;
    }

    /**
     * Evita que diferença irrelevante de precisão gere update desnecessário.
     */
    return Number(n.toFixed(6));
  }

/**
 * Recorte público comparável.
 *
 * Se campos públicos do card mudarem em public_profiles, o usersMap precisa
 * ser atualizado. Isso inclui localização, identidade pública e métricas
 * agregadas de mídia usadas pelo ranking canônico.
 */
private toComparablePublicProfile(
  user: IUserDados | null | undefined
): Record<string, unknown> | null {
  if (!user?.uid) {
    return null;
  }

  const anyUser = user as any;

  return {
    uid: this.toComparableText(anyUser.uid),

    nickname: this.toComparableText(anyUser.nickname),
    nicknameNormalized: this.toComparableText(anyUser.nicknameNormalized),

    photoURL: this.toComparableText(
      anyUser.photoURL ??
        anyUser.photoUrl ??
        anyUser.avatarUrl ??
        anyUser.avatarURL
    ),

    role: this.toComparableText(anyUser.role ?? 'free'),

    gender: this.toComparableText(
      anyUser.gender ??
        anyUser.genero
    ),

    orientation: this.toComparableText(
      anyUser.orientation ??
        anyUser.sexualOrientation ??
        anyUser.orientacao ??
        anyUser.orientacaoSexual
    ),

    estado: this.toComparableText(
      anyUser.estado ??
        anyUser.uf ??
        anyUser.state
    ),

    municipio: this.toComparableText(
      anyUser.municipio ??
        anyUser.cidade ??
        anyUser.city
    ),

    latitude: this.toComparableCoordinate(
      anyUser.latitude ??
        anyUser.lat
    ),

    longitude: this.toComparableCoordinate(
      anyUser.longitude ??
        anyUser.lng ??
        anyUser.lon
    ),

    geohash: this.toComparableText(anyUser.geohash),

    /**
     * Métricas públicas canônicas.
     *
     * Se uma dessas métricas mudar, o perfil público materializado no store
     * precisa ser atualizado para que o modo Online use o mesmo ranking do
     * discovery geral.
     */
    mediaCount: this.toOptionalNumber(anyUser.mediaCount ?? anyUser.publicMediaCount),
    photosCount: this.toOptionalNumber(anyUser.photosCount ?? anyUser.publicPhotosCount),
    videosCount: this.toOptionalNumber(anyUser.videosCount ?? anyUser.publicVideosCount),
    viewsCount: this.toOptionalNumber(
      anyUser.viewsCount ??
        anyUser.profileViewsCount ??
        anyUser.profileViews
    ),
    likesCount: this.toOptionalNumber(
      anyUser.likesCount ??
        anyUser.publicLikesCount ??
        anyUser.reactionsCount
    ),
    reactionsCount: this.toOptionalNumber(anyUser.reactionsCount),
    uniqueViewersCount: this.toOptionalNumber(anyUser.uniqueViewersCount),
    viewScore: this.toOptionalNumber(anyUser.viewScore),
    engagementScore: this.toOptionalNumber(anyUser.engagementScore),
    profileCompletenessScore: this.toOptionalNumber(anyUser.profileCompletenessScore),
    mediaMetricsUpdatedAt: this.toComparableText(anyUser.mediaMetricsUpdatedAt),
  };
}

  private areProfilesEquivalent(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (current === incoming) {
      return true;
    }

    if (!current || !incoming) {
      return false;
    }

    const a = this.toComparablePublicProfile(current);
    const b = this.toComparablePublicProfile(incoming);

    if (!a || !b) {
      return false;
    }

    return Object.keys(b).every((key) => a[key] === b[key]);
  }

  private shouldUpsertProfile(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (!incoming?.uid) {
      return false;
    }

    if (!current) {
      return true;
    }

    return !this.areProfilesEquivalent(current, incoming);
  }

/**
 * Gera uma assinatura estável apenas para mudanças que alteram a composição
 * ou o status imediatamente exibível da lista Online.
 *
 * Não entram no fingerprint:
 * - lastSeen;
 * - lastOnlineAt;
 * - lastOfflineAt;
 * - lastStateChangeAt;
 * - presenceSessionId.
 *
 * Motivo:
 * timestamps e sessão são dados operacionais da presença. Eles podem mudar
 * sem alterar os cards que precisam ser exibidos ou reidratados.
 */
private buildPresenceFingerprint(
  users: IUserDados[] | null | undefined,
  currentUid: string | null
): string {
  const normalized = this.normalizePresenceUsers(users, currentUid)
    .map((user) => {
      const anyUser = user as any;

      return {
        uid: this.toCleanText(anyUser.uid),
        isOnline: anyUser.isOnline === true,
        presenceState: this.toComparableText(anyUser.presenceState),
      };
    })
    .filter(
      (item): item is {
        uid: string;
        isOnline: boolean;
        presenceState: string;
      } => !!item.uid
    )
    .sort((a, b) =>
      a.uid.localeCompare(b.uid, 'pt-BR', {
        sensitivity: 'base',
      })
    );

  return JSON.stringify(normalized);
}

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
    const normalizedPresence = this.normalizePresenceUsers(
      presenceUsers,
      currentUid
    );

    const presenceByUid = new Map<string, IUserDados>();

    for (const presence of normalizedPresence) {
      const uid = this.toCleanText(presence.uid);

      if (uid) {
        presenceByUid.set(uid, presence);
      }
    }

    const uids = normalizedPresence
      .map((user) => this.toCleanText(user.uid))
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
              const uid = this.toCleanText(profile.uid);
              const presence = uid ? presenceByUid.get(uid) : null;

              return this.profileHydration.mergePresenceIntoPublicProfile(profile, presence);
            })
            .filter((user): user is IUserDados => !!user?.uid);

          const profileActions = publicProfiles
            .filter((profile) =>
              this.shouldUpsertProfile(usersMap?.[profile.uid], profile)
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

          if (this.canDebug()) {
            this.dbg('hydrateProfilesForOnlineUsers$', {
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
      tap((gate) => this.dbg('gate → state', gate)),

      switchMap((gate) => {
        if (!gate.canStart) {
          this.dbg('gate=false → STOP (reducer cleanup)');
          return of(stopOnlineUsersListener());
        }

        this.dbg('gate=true → START listener', { uid: gate.uid });

        return merge(
          of(startOnlineUsersListener()),

this.presenceQuery.getOnlineUsers$().pipe(
  map((presenceUsers) => ({
    presenceUsers,
    fingerprint: this.buildPresenceFingerprint(
      presenceUsers,
      gate.uid
    ),
  })),

  distinctUntilChanged(
    (previous, current) => previous.fingerprint === current.fingerprint
  ),

tap(({ presenceUsers, fingerprint }) =>
  this.dbg('presence emission accepted', {
    uid: gate.uid,
    fingerprintLength: fingerprint.length,
    total: Array.isArray(presenceUsers) ? presenceUsers.length : 0,
  })
),

  switchMap(({ presenceUsers }) =>
    this.hydrateProfilesForOnlineUsers$(presenceUsers, gate.uid)
  ),

  finalize(() =>
    this.dbg('realtime listener FINALIZE (unsub)')
  ),

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

  // ===========================================================================
  // 2) Snapshot único: loadOnlineUsers
  // ===========================================================================

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
        this.reportEffectError(
          err,
          'Falha ao filtrar usuários online por município.',
          'OnlineUsersEffects.filter'
        );

        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );
} // fim da classe OnlineUsersEffects com 1211 linhas
