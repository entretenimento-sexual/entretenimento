// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
//
// Consulta perfis públicos usados na descoberta.
//
// Arquitetura de cache:
// - AppCacheService é usado somente nas consultas com identidade semântica conhecida;
// - o cache é user-scoped, private e exclusivamente em memória;
// - o UID do viewer separa sessões e contas no mesmo navegador;
// - valores dos filtros participam da identidade, evitando colisões;
// - searchUsers(QueryConstraint[]) não é cacheado, porque QueryConstraint não possui
//   contrato público estável para serialização/fingerprint.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a chave baseada apenas em `constraint.type`.
//   Motivo: filtros diferentes podiam compartilhar resultados incorretos.
// - SUPRIMIDO o CacheService legado neste serviço.
//   Motivo: descoberta precisa de escopo por viewer, resultado discriminado e
//   persistência explicitamente desativada.
// - SUPRIMIDA a inscrição vazia em uid$ no construtor.
//   Motivo: a limpeza por troca de UID já pertence ao ciclo de vida central do cache.
import { Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  QueryConstraint,
  documentId,
  where,
} from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { AppCacheService } from '@core/services/general/cache/app-cache.service';
import {
  CacheDefinition,
  CacheResult,
} from '@core/services/general/cache/cache-contracts';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

type DiscoveryQueryOptions = {
  cacheTTL?: number;
  firestoreCacheTTL?: number;
  cacheIdentity?: string | null;
  errorContext?: string;
};

@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private readonly DISCOVERY_COL = 'public_profiles';

  private static readonly UID_BATCH_SIZE = 10;
  private static readonly DEFAULT_CACHE_TTL_MS = 30_000;
  private static readonly ALL_PROFILES_CACHE_TTL_MS = 10 * 60_000;

  private readonly uid$ = this.authSession.uid$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: AppCacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) {}

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

  private firstValue<T = unknown>(source: any, keys: readonly string[]): T | null {
    for (const key of keys) {
      const value = source?.[key];

      if (value !== undefined && value !== null) {
        return value as T;
      }
    }

    return null;
  }

  private firstStringArray(source: any, keys: readonly string[]): readonly string[] | null {
    for (const key of keys) {
      const value = source?.[key];

      if (!Array.isArray(value)) {
        continue;
      }

      const cleaned = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      if (cleaned.length) {
        return cleaned;
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
   * Lê o primeiro campo numérico válido de uma lista de aliases.
   *
   * Mantém o mapper compatível com campos antigos e novos de public_profiles,
   * sem recalcular métrica no front.
   */
  private firstNumber(source: any, keys: readonly string[]): number | null {
    return this.toOptionalNumber(this.firstValue(source, keys));
  }

  private hasText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasFiniteNumber(value: unknown): boolean {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(n);
  }

  private normalizeUidList(uids: string[] | null | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const raw of uids ?? []) {
      const uid = (raw ?? '').trim();

      if (!uid || seen.has(uid)) {
        continue;
      }

      seen.add(uid);
      out.push(uid);
    }

    return out;
  }

  private chunk<T>(list: T[], size: number): T[][] {
    if (!list.length || size <= 0) {
      return [];
    }

    const out: T[][] = [];

    for (let i = 0; i < list.length; i += size) {
      out.push(list.slice(i, i + size));
    }

    return out;
  }

  private toUserDadosFromPublicProfile(raw: any): IUserDados {
    const uid = this.firstText(raw, ['uid']) ?? '';
    const nickname = this.firstText(raw, ['nickname']);

    const latitude = this.toOptionalNumber(
      this.firstValue(raw, ['latitude', 'lat'])
    );

    const longitude = this.toOptionalNumber(
      this.firstValue(raw, ['longitude', 'lng', 'lon'])
    );

    /**
     * Métricas públicas canônicas de mídia.
     *
     * Fonte real: functions/src/media/application/public-profile-media-metrics.ts
     * Documento: public_profiles/{uid}
     *
     * Este service apenas lê e repassa. Não calcula score e não ordena perfis.
     * O score fica centralizado em DiscoveryCardEnrichmentService +
     * discovery-profile-score.utils.ts.
     */
    const mediaCount = this.firstNumber(raw, ['mediaCount', 'publicMediaCount']);
    const photosCount = this.firstNumber(raw, ['photosCount', 'publicPhotosCount']);
    const videosCount = this.firstNumber(raw, ['videosCount', 'publicVideosCount']);
    const viewsCount = this.firstNumber(raw, [
      'viewsCount',
      'profileViewsCount',
      'profileViews',
    ]);
    const likesCount = this.firstNumber(raw, [
      'likesCount',
      'publicLikesCount',
      'reactionsCount',
    ]);
    const reactionsCount = this.firstNumber(raw, ['reactionsCount']) ?? likesCount;
    const uniqueViewersCount = this.firstNumber(raw, ['uniqueViewersCount']);
    const viewScore = this.firstNumber(raw, ['viewScore']);
    const engagementScore = this.firstNumber(raw, ['engagementScore']);
    const profileCompletenessScore = this.firstNumber(raw, [
      'profileCompletenessScore',
    ]);

    return {
      uid,

      nickname,
      nicknameNormalized:
        this.firstText(raw, ['nicknameNormalized']) ??
        nickname?.toLowerCase() ??
        null,

      photoURL: this.firstText(raw, [
        'photoURL',
        'photoUrl',
        'avatarUrl',
        'avatarURL',
      ]),

      role: this.firstText(raw, ['role']) ?? 'free',

      gender: this.firstText(raw, [
        'gender',
        'genero',
      ]),

      age: this.firstValue(raw, ['age', 'idade']) ?? null,

      orientation: this.firstText(raw, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]),

      normalizedGender: this.firstText(raw, [
        'normalizedGender',
      ]),

      normalizedOrientation: this.firstText(raw, [
        'normalizedOrientation',
      ]),

      compatibilityReady:
        typeof raw?.compatibilityReady === 'boolean'
          ? raw.compatibilityReady
          : null,

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

      preferences: this.firstStringArray(raw, [
        'preferences',
        'preferencias',
        'interests',
        'interesses',
        'lookingFor',
        'buscando',
      ]),

      interestedInGenders: this.firstStringArray(raw, [
        'interestedInGenders',
        'interestedInGender',
        'targetGenders',
        'preferredGenders',
        'generosDeInteresse',
      ]),

      interestedInOrientations: this.firstStringArray(raw, [
        'interestedInOrientations',
        'interestedInOrientation',
        'targetOrientations',
        'preferredOrientations',
        'orientacoesDeInteresse',
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

      latitude,
      longitude,
      geohash: this.firstText(raw, ['geohash']),

      createdAt: this.firstValue(raw, ['createdAt']) ?? null,
      updatedAt: this.firstValue(raw, ['updatedAt']) ?? null,

      /**
       * Métricas públicas agregadas.
       *
       * Esses campos são consumidos pelo score canônico de discovery.
       * Mantemos também aliases legados para evitar quebra em componentes
       * que ainda leem publicMediaCount/profileViewsCount/publicLikesCount.
       */
      mediaCount,
      publicMediaCount: mediaCount,
      photosCount,
      publicPhotosCount: photosCount,
      videosCount,
      publicVideosCount: videosCount,
      viewsCount,
      profileViewsCount: viewsCount,
      profileViews: viewsCount,
      likesCount,
      publicLikesCount: likesCount,
      reactionsCount,
      uniqueViewersCount,
      viewScore,
      engagementScore,
      profileCompletenessScore,
      mediaMetricsUpdatedAt: this.firstValue(raw, ['mediaMetricsUpdatedAt']) ?? null,

      isOnline: false,
      lastSeen: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
    } as unknown as IUserDados;
  }

  private isPublicProfileUsableForCard(
    profile: IUserDados | null | undefined
  ): boolean {
    if (!profile?.uid) {
      return false;
    }

    if (!this.hasText((profile as any).nickname)) {
      return false;
    }

    const hasGender = this.hasText((profile as any).gender);
    const hasOrientation = this.hasText((profile as any).orientation);
    const hasLocationText =
      this.hasText((profile as any).municipio) ||
      this.hasText((profile as any).estado);
    const hasCoords =
      this.hasFiniteNumber((profile as any).latitude) &&
      this.hasFiniteNumber((profile as any).longitude);
    const hasPhoto = this.hasText((profile as any).photoURL);

    return hasGender || hasOrientation || hasLocationText || hasCoords || hasPhoto;
  }

  private pickProfilesByRequestedUids(
    profiles: IUserDados[] | null | undefined,
    requestedUids: readonly string[]
  ): IUserDados[] {
    if (!profiles?.length) {
      return [];
    }

    const requested = new Set(requestedUids);
    const byUid = new Map<string, IUserDados>();

    for (const profile of profiles) {
      const uid = (profile?.uid ?? '').trim();

      if (!uid || !requested.has(uid)) {
        continue;
      }

      if (!this.isPublicProfileUsableForCard(profile)) {
        continue;
      }

      byUid.set(uid, profile);
    }

    return requestedUids
      .map((uid) => byUid.get(uid) ?? null)
      .filter((profile): profile is IUserDados => !!profile);
  }

  private cachedProfilesCoverRequestedUids(
    profiles: IUserDados[],
    requestedUids: readonly string[]
  ): boolean {
    if (profiles.length !== requestedUids.length) {
      return false;
    }

    const present = new Set(profiles.map((profile) => profile.uid));
    return requestedUids.every((uid) => present.has(uid));
  }

  private normalizeIdentityValue(value: string): string {
    return value
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
  }

  private semanticIdentity(kind: string, values: readonly string[]): string {
    return `${kind}:${JSON.stringify(
      values.map((value) => this.normalizeIdentityValue(value))
    )}`;
  }

  private uidIdentity(kind: string, uids: readonly string[]): string {
    return `${kind}:${JSON.stringify(uids)}`;
  }

  private isPublicProfileList(value: unknown): value is IUserDados[] {
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as { uid?: unknown }).uid === 'string'
      )
    );
  }

  private cacheDefinition(
    viewerUid: string,
    identity: string,
    ttlMs: number
  ): CacheDefinition<IUserDados[]> {
    return {
      key: `discovery:${identity}`,
      scope: 'user',
      ownerUid: viewerUid,
      sensitivity: 'private',
      storage: 'memory',
      ttlMs,
      version: 1,
      validate: (value: unknown): value is IUserDados[] =>
        this.isPublicProfileList(value),
    };
  }

  private cacheValue(
    result: CacheResult<IUserDados[]>
  ): IUserDados[] | null {
    return result.status === 'miss' ? null : result.value;
  }

  private readProfilesOnce$(
    constraints: QueryConstraint[],
    firestoreCacheTTL: number
  ): Observable<IUserDados[]> {
    return this.read
      .getDocumentsOnce<any>(this.DISCOVERY_COL, constraints, {
        useCache: true,
        cacheTTL: firestoreCacheTTL,
        mapIdField: 'uid',
        requireAuth: true,
      })
      .pipe(
        map((docs) =>
          (docs ?? []).map((doc) =>
            this.toUserDadosFromPublicProfile(doc)
          )
        )
      );
  }

  private onceGuardedQuery(
    constraints: QueryConstraint[] = [],
    options: DiscoveryQueryOptions = {}
  ): Observable<IUserDados[]> {
    const cacheTTL =
      options.cacheTTL ?? UserDiscoveryQueryService.DEFAULT_CACHE_TTL_MS;
    const firestoreCacheTTL = options.firestoreCacheTTL ?? cacheTTL;
    const cacheIdentity = this.toCleanText(options.cacheIdentity);
    const errorContext =
      options.errorContext ?? 'user-discovery.onceGuardedQuery';

    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return of([] as IUserDados[]);
        }

        const fetch$ = this.readProfilesOnce$(
          constraints,
          firestoreCacheTTL
        );

        // QueryConstraint arbitrária não recebe fingerprint implícito.
        if (!cacheIdentity) {
          return fetch$;
        }

        const definition = this.cacheDefinition(
          uid,
          cacheIdentity,
          cacheTTL
        );

        return this.cache.get$(definition).pipe(
          switchMap((result) => {
            if (result.status !== 'miss') {
              // Inclusive [] é hit válido e evita repetição desnecessária de leitura.
              return of(result.value);
            }

            return fetch$.pipe(
              switchMap((users) =>
                this.cache
                  .set$(definition, users)
                  .pipe(map(() => users))
              )
            );
          })
        );
      }),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
          err,
          [],
          {
            silent: true,
            context: errorContext,
          }
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Compatibilidade para callers que fornecem QueryConstraint diretamente.
   *
   * Sem cache de aplicação por decisão arquitetural: o SDK não oferece uma
   * serialização pública estável que inclua campos, operadores e valores.
   */
  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.onceGuardedQuery(constraints ?? [], {
      firestoreCacheTTL: 60_000,
      cacheIdentity: null,
      errorContext: 'user-discovery.searchUsers',
    });
  }

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    const g = (gender ?? '').trim();
    const o = (orientation ?? '').trim();
    const m = (municipio ?? '').trim();

    if (!g || !o || !m) {
      return of([] as IUserDados[]);
    }

    return this.onceGuardedQuery(
      [
        where('gender', '==', g),
        where('orientation', '==', o),
        where('municipio', '==', m),
      ],
      {
        cacheTTL: 60_000,
        cacheIdentity: this.semanticIdentity(
          'orientation-location',
          [g, o, m]
        ),
        errorContext:
          'user-discovery.getProfilesByOrientationAndLocation',
      }
    );
  }

  getUsersByGender$(gender: string): Observable<IUserDados[]> {
    const clean = this.toCleanText(gender);

    if (!clean) {
      return of([] as IUserDados[]);
    }

    return this.onceGuardedQuery(
      [where('gender', '==', clean)],
      {
        cacheIdentity: this.semanticIdentity('gender', [clean]),
        errorContext: 'user-discovery.getUsersByGender$',
      }
    );
  }

  getUsersByOrientation$(orientation: string): Observable<IUserDados[]> {
    const clean = this.toCleanText(orientation);

    if (!clean) {
      return of([] as IUserDados[]);
    }

    return this.onceGuardedQuery(
      [where('orientation', '==', clean)],
      {
        cacheIdentity: this.semanticIdentity('orientation', [clean]),
        errorContext: 'user-discovery.getUsersByOrientation$',
      }
    );
  }

  getUsersByLocation$(state: string, city?: string): Observable<IUserDados[]> {
    const cleanState = this.toCleanText(state);
    const cleanCity = this.toCleanText(city);

    if (!cleanState) {
      return of([] as IUserDados[]);
    }

    const constraints: QueryConstraint[] = [
      where('estado', '==', cleanState),
    ];

    if (cleanCity) {
      constraints.push(where('municipio', '==', cleanCity));
    }

    return this.onceGuardedQuery(constraints, {
      cacheIdentity: this.semanticIdentity('location', [
        cleanState,
        cleanCity ?? '*',
      ]),
      errorContext: 'user-discovery.getUsersByLocation$',
    });
  }

  getProfilesByUids$(
    uids: string[] | null | undefined,
    opts?: { cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const requestedOrder = this.normalizeUidList(uids);

    if (!requestedOrder.length) {
      return of([] as IUserDados[]);
    }

    const sorted = [...requestedOrder].sort();
    const cacheTTL =
      opts?.cacheTTL ?? UserDiscoveryQueryService.DEFAULT_CACHE_TTL_MS;

    return this.uid$.pipe(
      take(1),
      switchMap((viewerUid) => {
        if (!viewerUid) {
          return of([] as IUserDados[]);
        }

        const allDefinition = this.cacheDefinition(
          viewerUid,
          'all',
          UserDiscoveryQueryService.ALL_PROFILES_CACHE_TTL_MS
        );
        const byUidsDefinition = this.cacheDefinition(
          viewerUid,
          this.uidIdentity('uids', sorted),
          cacheTTL
        );

        return forkJoin({
          cachedAll: this.cache.get$(allDefinition).pipe(take(1)),
          cachedByUids: this.cache.get$(byUidsDefinition).pipe(take(1)),
        }).pipe(
          switchMap(({ cachedAll, cachedByUids }) => {
            const fromAllCache = this.pickProfilesByRequestedUids(
              this.cacheValue(cachedAll),
              sorted
            );

            if (this.cachedProfilesCoverRequestedUids(fromAllCache, sorted)) {
              return this.cache
                .set$(byUidsDefinition, fromAllCache)
                .pipe(
                  map(() =>
                    this.pickProfilesByRequestedUids(
                      fromAllCache,
                      requestedOrder
                    )
                  )
                );
            }

            const fromUidCache = this.pickProfilesByRequestedUids(
              this.cacheValue(cachedByUids),
              sorted
            );

            if (this.cachedProfilesCoverRequestedUids(fromUidCache, sorted)) {
              return of(
                this.pickProfilesByRequestedUids(
                  fromUidCache,
                  requestedOrder
                )
              );
            }

            const batches = this.chunk(
              sorted,
              UserDiscoveryQueryService.UID_BATCH_SIZE
            );

            const reads$ = batches.map((batch) =>
              this.onceGuardedQuery(
                [where(documentId(), 'in', batch)],
                {
                  cacheTTL,
                  cacheIdentity: this.uidIdentity('uids-batch', batch),
                  errorContext:
                    'user-discovery.getProfilesByUids$.batch',
                }
              )
            );

            return forkJoin(reads$).pipe(
              map((parts) => parts.flat()),
              map((profiles) => {
                const byUid = new Map<string, IUserDados>();

                for (const profile of profiles ?? []) {
                  const profileUid = (profile?.uid ?? '').trim();

                  if (profileUid) {
                    byUid.set(profileUid, profile);
                  }
                }

                return sorted
                  .map((requestedUid) => byUid.get(requestedUid) ?? null)
                  .filter((profile): profile is IUserDados => !!profile);
              }),
              switchMap((profilesInSortedOrder) =>
                this.cache
                  .set$(byUidsDefinition, profilesInSortedOrder)
                  .pipe(
                    map(() =>
                      this.pickProfilesByRequestedUids(
                        profilesInSortedOrder,
                        requestedOrder
                      )
                    )
                  )
              )
            );
          })
        );
      }),
      catchError((err) =>
        this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
          err,
          [],
          {
            silent: true,
            context: 'user-discovery.getProfilesByUids$',
          }
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getAllUsers$(): Observable<IUserDados[]> {
    return this.onceGuardedQuery([], {
      cacheTTL: UserDiscoveryQueryService.ALL_PROFILES_CACHE_TTL_MS,
      firestoreCacheTTL: 300_000,
      cacheIdentity: 'all',
      errorContext: 'user-discovery.getAllUsers$',
    });
  }
}
