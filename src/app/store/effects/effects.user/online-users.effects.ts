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

import { environment } from 'src/environments/environment';

import { AppState } from '../../states/app.state';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { IError } from '@core/interfaces/ierror';

import {
  sanitizeUserForStore,
  sanitizeUsersForStore,
} from 'src/app/store/utils/user-store.serializer';

import { toStoreError } from 'src/app/store/utils/store-error.serializer';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

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

  private readonly debug = !environment.production;
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

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[OnlineUsersEffects] ${msg}`, extra ?? '');
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

  private firstText(source: any, keys: readonly string[]): string | null {
    for (const key of keys) {
      const value = this.toCleanText(source?.[key]);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private firstValue<T = unknown>(
    source: any,
    keys: readonly string[]
  ): T | null {
    for (const key of keys) {
      const value = source?.[key];

      if (value !== undefined && value !== null) {
        return value as T;
      }
    }

    return null;
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
   * Se campos como latitude, longitude, geohash, foto, nickname ou município
   * mudarem em public_profiles, o usersMap precisa ser atualizado.
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
   * Normaliza o documento público vindo de public_profiles para o formato que o
   * UserCardComponent entende.
   *
   * Esta etapa corrige a pane "Localização não informada" no modo Online.
   *
   * Motivo:
   * - public_profiles pode ter campos com nomes ligeiramente diferentes;
   * - sanitizeUserForStore pode remover ou não preservar algum alias;
   * - o modo Online precisa preservar os mesmos metadados que o modo Todos:
   *   gênero, orientação, município, estado, coordenadas, foto e role.
   *
   * Segurança:
   * - não inclui e-mail;
   * - não inclui telefone;
   * - não inclui dados privados do users/{uid};
   * - só materializa dados públicos usados no card.
   */
  private normalizePublicProfileForOnline(
    rawProfile: IUserDados | null | undefined
  ): IUserDados | null {
    if (!rawProfile) {
      return null;
    }

    const raw = rawProfile as any;

    const uid = this.firstText(raw, ['uid']);
    const nickname = this.firstText(raw, ['nickname']);

    if (!uid || !nickname) {
      return null;
    }

    const latitude = this.toOptionalNumber(
      this.firstValue(raw, ['latitude', 'lat'])
    );

    const longitude = this.toOptionalNumber(
      this.firstValue(raw, ['longitude', 'lng', 'lon'])
    );

    const normalized = {
      ...rawProfile,

      uid,
      nickname,

      nicknameNormalized:
        this.firstText(raw, ['nicknameNormalized']) ??
        nickname.trim().toLowerCase(),

      photoURL: this.firstText(raw, [
        'photoURL',
        'photoUrl',
        'avatarUrl',
        'avatarURL',
      ]),

      gender: this.firstText(raw, [
        'gender',
        'genero',
      ]),

      orientation: this.firstText(raw, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]),

      partner1Orientation: this.firstText(raw, [
        'partner1Orientation',
        'orientation1',
        'orientacaoParceiro1',
      ]),

      partner2Orientation: this.firstText(raw, [
        'partner2Orientation',
        'orientation2',
        'orientacaoParceiro2',
      ]),

      municipio: this.firstText(raw, [
        'municipio',
        'cidade',
        'city',
      ]),

      estado: this.firstText(raw, [
        'estado',
        'uf',
        'state',
      ]),

      role:
        this.firstText(raw, ['role']) ??
        'free',

      latitude,
      longitude,

      geohash: this.firstText(raw, ['geohash']),

      createdAt: this.firstValue(raw, ['createdAt']),
      updatedAt: this.firstValue(raw, ['updatedAt']),
    } as IUserDados;

    /**
     * Sanitiza e reimpõe os campos públicos normalizados.
     *
     * Isso evita regressão caso o serializer não preserve algum alias relevante
     * para o card, sem permitir que dados privados entrem no objeto final.
     */
    const safe = sanitizeUserForStore(normalized) as IUserDados | null;

    if (!safe?.uid) {
      return null;
    }

    return {
      ...safe,

      uid,
      nickname,

      nicknameNormalized: (normalized as any).nicknameNormalized,

      photoURL: (normalized as any).photoURL,

      gender: (normalized as any).gender,
      orientation: (normalized as any).orientation,
      partner1Orientation: (normalized as any).partner1Orientation,
      partner2Orientation: (normalized as any).partner2Orientation,

      municipio: (normalized as any).municipio,
      estado: (normalized as any).estado,

      role: (normalized as any).role,

      latitude: (normalized as any).latitude,
      longitude: (normalized as any).longitude,
      geohash: (normalized as any).geohash,

createdAt: this.toSerializableStoreValue((normalized as any).createdAt),
updatedAt: this.toSerializableStoreValue((normalized as any).updatedAt),
    } as IUserDados;
  }

  /**
   * Junta public_profiles + presence.
   *
   * Regra:
   * - public_profiles é a base persistente do card;
   * - presence só entra com status/timestamps efêmeros;
   * - presence nunca deve apagar dados públicos.
   *
   * Esta função também reimpõe os metadados públicos após sanitizeUserForStore
   * para impedir a regressão "Localização não informada".
   */
  private mergePresenceIntoPublicProfile(
    profile: IUserDados,
    presence: IUserDados | null | undefined
  ): IUserDados {
    const anyProfile = profile as any;
    const anyPresence = presence as any;

    const merged = {
      ...profile,

      uid: anyProfile.uid,

      /**
       * Não inferimos online por lastSeen.
       * Online vem explicitamente de presence.isOnline.
       */
      isOnline: anyPresence?.isOnline === true,

      lastSeen:
        anyPresence?.lastSeen ??
        anyProfile.lastSeen ??
        null,

      lastOnlineAt:
        anyPresence?.lastOnlineAt ??
        anyProfile.lastOnlineAt ??
        null,

      lastOfflineAt:
        anyPresence?.lastOfflineAt ??
        anyProfile.lastOfflineAt ??
        null,

      lastStateChangeAt:
        anyPresence?.lastStateChangeAt ??
        anyProfile.lastStateChangeAt ??
        null,

      presenceState:
        anyPresence?.presenceState ??
        anyProfile.presenceState ??
        null,

      presenceSessionId:
        anyPresence?.presenceSessionId ??
        anyProfile.presenceSessionId ??
        null,
    } as IUserDados;

    const safe = sanitizeUserForStore(merged) as IUserDados | null;

    return {
      ...(safe ?? merged),

      uid: anyProfile.uid,
      nickname: anyProfile.nickname,
      nicknameNormalized: anyProfile.nicknameNormalized,

      photoURL: anyProfile.photoURL,

      gender: anyProfile.gender,
      orientation: anyProfile.orientation,
      partner1Orientation: anyProfile.partner1Orientation,
      partner2Orientation: anyProfile.partner2Orientation,

      municipio: anyProfile.municipio,
      estado: anyProfile.estado,

      role: anyProfile.role,

      latitude: anyProfile.latitude,
      longitude: anyProfile.longitude,
      geohash: anyProfile.geohash,

createdAt: this.toSerializableStoreValue(anyProfile.createdAt),
updatedAt: this.toSerializableStoreValue(anyProfile.updatedAt),

isOnline: anyPresence?.isOnline === true,

lastSeen: this.toSerializableStoreValue(
  anyPresence?.lastSeen ??
    anyProfile.lastSeen ??
    null
),

lastOnlineAt: this.toSerializableStoreValue(
  anyPresence?.lastOnlineAt ??
    anyProfile.lastOnlineAt ??
    null
),

lastOfflineAt: this.toSerializableStoreValue(
  anyPresence?.lastOfflineAt ??
    anyProfile.lastOfflineAt ??
    null
),

lastStateChangeAt: this.toSerializableStoreValue(
  anyPresence?.lastStateChangeAt ??
    anyProfile.lastStateChangeAt ??
    null
),

      presenceState:
        anyPresence?.presenceState ??
        anyProfile.presenceState ??
        null,

      presenceSessionId:
        anyPresence?.presenceSessionId ??
        anyProfile.presenceSessionId ??
        null,
    } as IUserDados;
  }

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
            .map((profile) => this.normalizePublicProfileForOnline(profile))
            .filter((profile): profile is IUserDados => !!profile?.uid);

          const hydratedOnlineUsers = publicProfiles
            .map((profile) => {
              const uid = this.toCleanText(profile.uid);
              const presence = uid ? presenceByUid.get(uid) : null;

              return this.mergePresenceIntoPublicProfile(profile, presence);
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

          this.dbg('hydrateProfilesForOnlineUsers$', {
            presenceTotal: normalizedPresence.length,
            profilesTotal: publicProfiles.length,
            hydratedOnlineTotal: hydratedOnlineUsers.length,
            profileActionsTotal: profileActions.length,
            uids,
            hydrated: hydratedOnlineUsers.map((profile) => ({
              uid: profile.uid,
              nickname: profile.nickname,
              isOnline: (profile as any).isOnline,
              presenceState: (profile as any).presenceState,
              latitude: (profile as any).latitude,
              longitude: (profile as any).longitude,
              geohash: (profile as any).geohash,
              gender: (profile as any).gender,
              orientation: (profile as any).orientation,
              estado: (profile as any).estado,
              municipio: (profile as any).municipio,
              role: (profile as any).role,
            })),
          });

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
      fingerprint,
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

  private toSerializableStoreValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const maybeTimestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  } | null | undefined;

  if (typeof maybeTimestamp?.toMillis === 'function') {
    const millis = maybeTimestamp.toMillis();

    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof maybeTimestamp?.toDate === 'function') {
    const millis = maybeTimestamp.toDate().getTime();

    return Number.isFinite(millis) ? millis : null;
  }

  if (
    typeof maybeTimestamp?.seconds === 'number' &&
    Number.isFinite(maybeTimestamp.seconds)
  ) {
    return maybeTimestamp.seconds * 1000;
  }

  return null;
}

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
} // fim da classe OnlineUsersEffects com 1027 linhas