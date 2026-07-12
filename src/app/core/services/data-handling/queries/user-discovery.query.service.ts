// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
// -----------------------------------------------------------------------------
// Consultas pontuais de public_profiles.
//
// Regras arquiteturais:
// - descoberta geral/compatível usa DiscoveryPublicProfilesRepository paginado;
// - este serviço atende apenas buscas específicas e hidratação por UID;
// - nenhuma API carrega integralmente public_profiles;
// - cache só é usado com chave determinística baseada nos valores da consulta;
// - todo cache é separado por sessão autenticada e removido no logout;
// - QueryConstraint genérica não recebe cache de aplicação para evitar colisão;
// - erros continuam centralizados e a API pública permanece Observable-first.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import {
  QueryConstraint,
  documentId,
  where,
} from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';

interface DiscoveryQueryOptions {
  readonly cacheTTL?: number;
  readonly cacheKey?: string | null;
}

@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private static readonly DISCOVERY_COL = 'public_profiles';
  private static readonly UID_BATCH_SIZE = 10;
  private static readonly DEFAULT_CACHE_TTL_MS = 30_000;
  private static readonly SENSITIVE_CACHE_PREFIX =
    'discovery:public_profiles:uids:';

  private readonly uid$ = this.authSession.uid$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) {}

  /**
   * Consulta genérica sem cache de aplicação.
   *
   * QueryConstraint não expõe contrato público estável para serialização dos
   * valores. Cachear apenas por `constraint.type` misturava consultas distintas.
   */
  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.runGuardedQuery(constraints ?? [], {
      cacheKey: null,
    });
  }

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    const normalizedGender = this.toCleanText(gender);
    const normalizedOrientation = this.toCleanText(orientation);
    const normalizedMunicipio = this.toCleanText(municipio);

    if (!normalizedGender || !normalizedOrientation || !normalizedMunicipio) {
      return of([]);
    }

    return this.runGuardedQuery(
      [
        where('gender', '==', normalizedGender),
        where('orientation', '==', normalizedOrientation),
        where('municipio', '==', normalizedMunicipio),
      ],
      {
        cacheTTL: 60_000,
        cacheKey: this.buildKnownQueryCacheKey('orientation-location', [
          normalizedGender,
          normalizedOrientation,
          normalizedMunicipio,
        ]),
      }
    );
  }

  getUsersByGender$(gender: string): Observable<IUserDados[]> {
    const normalizedGender = this.toCleanText(gender);

    if (!normalizedGender) {
      return of([]);
    }

    return this.runGuardedQuery(
      [where('gender', '==', normalizedGender)],
      {
        cacheKey: this.buildKnownQueryCacheKey('gender', [normalizedGender]),
      }
    );
  }

  getUsersByOrientation$(orientation: string): Observable<IUserDados[]> {
    const normalizedOrientation = this.toCleanText(orientation);

    if (!normalizedOrientation) {
      return of([]);
    }

    return this.runGuardedQuery(
      [where('orientation', '==', normalizedOrientation)],
      {
        cacheKey: this.buildKnownQueryCacheKey('orientation', [
          normalizedOrientation,
        ]),
      }
    );
  }

  getUsersByLocation$(
    state: string,
    city?: string
  ): Observable<IUserDados[]> {
    const normalizedState = this.toCleanText(state);
    const normalizedCity = this.toCleanText(city);

    if (!normalizedState) {
      return of([]);
    }

    const constraints: QueryConstraint[] = [
      where('estado', '==', normalizedState),
    ];

    if (normalizedCity) {
      constraints.push(where('municipio', '==', normalizedCity));
    }

    return this.runGuardedQuery(constraints, {
      cacheKey: this.buildKnownQueryCacheKey('location', [
        normalizedState,
        normalizedCity ?? '*',
      ]),
    });
  }

  /**
   * Hidrata somente os proprietários necessários para cards/mídias.
   *
   * O cache externo usa a lista ordenada de UIDs e a sessão autenticada. As
   * consultas internas não usam cache genérico, evitando que batches distintos
   * compartilhem resultado.
   */
  getProfilesByUids$(
    uids: string[] | null | undefined,
    options?: { cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const normalizedUids = this.normalizeUidList(uids).sort();

    if (!normalizedUids.length) {
      return of([]);
    }

    const cacheTTL = options?.cacheTTL ?? 30_000;
    const baseCacheKey = `${UserDiscoveryQueryService.SENSITIVE_CACHE_PREFIX}${normalizedUids.join(',')}`;

    return this.uid$.pipe(
      take(1),
      switchMap((authUid) => {
        if (!authUid) {
          return of([]);
        }

        const cacheKey = this.scopeCacheKey(baseCacheKey, authUid);

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          take(1),
          switchMap((cachedProfiles) => {
            const cachedSelection = this.pickProfilesByRequestedUids(
              cachedProfiles,
              normalizedUids
            );

            if (
              cachedProfiles !== null &&
              cachedSelection.length === normalizedUids.length
            ) {
              return of(cachedSelection);
            }

            const batches = this.chunk(
              normalizedUids,
              UserDiscoveryQueryService.UID_BATCH_SIZE
            );
            const reads$ = batches.map((batch) =>
              this.runGuardedQuery(
                [where(documentId(), 'in', batch)],
                { cacheKey: null }
              )
            );

            return forkJoin(reads$).pipe(
              map((parts) => parts.flat()),
              map((profiles) =>
                this.pickProfilesByRequestedUids(
                  profiles,
                  normalizedUids
                )
              ),
              tap((profiles) => {
                this.cache.set(cacheKey, profiles, cacheTTL, {
                  persist: true,
                });
              })
            );
          }),
          catchError((error) =>
            this.handleError(error, 'user-discovery.getProfilesByUids$')
          )
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private runGuardedQuery(
    constraints: QueryConstraint[],
    options: DiscoveryQueryOptions = {}
  ): Observable<IUserDados[]> {
    const cacheTTL =
      options.cacheTTL ??
      UserDiscoveryQueryService.DEFAULT_CACHE_TTL_MS;
    const baseCacheKey = options.cacheKey ?? null;

    return this.uid$.pipe(
      take(1),
      switchMap((authUid) => {
        if (!authUid) {
          return of([]);
        }

        const cacheKey = baseCacheKey
          ? this.scopeCacheKey(baseCacheKey, authUid)
          : null;
        const server$ = this.read
          .getDocumentsOnce<Record<string, unknown>>(
            UserDiscoveryQueryService.DISCOVERY_COL,
            constraints ?? [],
            {
              source: 'server',
              mapIdField: 'uid',
              requireAuth: true,
            }
          )
          .pipe(
            map((documents) =>
              (documents ?? [])
                .map((document) =>
                  this.toUserDadosFromPublicProfile(document)
                )
                .filter((profile): profile is IUserDados => profile !== null)
            )
          );

        if (!cacheKey) {
          return server$.pipe(
            catchError((error) =>
              this.handleError(error, 'user-discovery.runGuardedQuery')
            )
          );
        }

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          take(1),
          switchMap((cachedProfiles) => {
            if (cachedProfiles !== null) {
              return of(cachedProfiles);
            }

            return server$.pipe(
              tap((profiles) => {
                this.cache.set(cacheKey, profiles, cacheTTL, {
                  persist: true,
                });
              })
            );
          }),
          catchError((error) =>
            this.handleError(error, 'user-discovery.runGuardedQuery.cache')
          )
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private handleError(
    error: unknown,
    context: string
  ): Observable<IUserDados[]> {
    return this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
      error,
      [],
      {
        silent: true,
        context,
      }
    );
  }

  private toUserDadosFromPublicProfile(
    raw: Record<string, unknown>
  ): IUserDados | null {
    const uid = this.firstText(raw, ['uid']);
    const nickname = this.firstText(raw, ['nickname']);

    if (!uid || !nickname) {
      return null;
    }

    const mediaCount = this.firstNumber(raw, [
      'mediaCount',
      'publicMediaCount',
    ]);
    const photosCount = this.firstNumber(raw, [
      'photosCount',
      'publicPhotosCount',
    ]);
    const videosCount = this.firstNumber(raw, [
      'videosCount',
      'publicVideosCount',
    ]);
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
    const reactionsCount =
      this.firstNumber(raw, ['reactionsCount']) ?? likesCount;

    return {
      uid,
      nickname,
      nicknameNormalized:
        this.firstText(raw, ['nicknameNormalized']) ??
        nickname.toLowerCase(),
      photoURL: this.firstText(raw, [
        'photoURL',
        'photoUrl',
        'avatarUrl',
        'avatarURL',
      ]),
      role: this.firstText(raw, ['role']) ?? 'free',
      gender: this.firstText(raw, ['gender', 'genero']),
      age: this.firstValue(raw, ['age', 'idade']) ?? null,
      orientation: this.firstText(raw, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]),
      normalizedGender: this.firstText(raw, ['normalizedGender']),
      normalizedOrientation: this.firstText(raw, [
        'normalizedOrientation',
      ]),
      compatibilityReady:
        typeof raw['compatibilityReady'] === 'boolean'
          ? raw['compatibilityReady']
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
      estado: this.firstText(raw, ['estado', 'uf', 'state']),
      latitude: this.firstNumber(raw, ['latitude', 'lat']),
      longitude: this.firstNumber(raw, ['longitude', 'lng', 'lon']),
      geohash: this.firstText(raw, ['geohash']),
      createdAt: this.firstValue(raw, ['createdAt']) ?? null,
      updatedAt: this.firstValue(raw, ['updatedAt']) ?? null,
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
      uniqueViewersCount: this.firstNumber(raw, [
        'uniqueViewersCount',
      ]),
      viewScore: this.firstNumber(raw, ['viewScore']),
      engagementScore: this.firstNumber(raw, ['engagementScore']),
      profileCompletenessScore: this.firstNumber(raw, [
        'profileCompletenessScore',
      ]),
      mediaMetricsUpdatedAt:
        this.firstValue(raw, ['mediaMetricsUpdatedAt']) ?? null,
      isOnline: false,
      lastSeen: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
    } as unknown as IUserDados;
  }

  private pickProfilesByRequestedUids(
    profiles: IUserDados[] | null | undefined,
    requestedUids: readonly string[]
  ): IUserDados[] {
    const requested = new Set(requestedUids);
    const byUid = new Map<string, IUserDados>();

    for (const profile of profiles ?? []) {
      const uid = this.toCleanText(profile?.uid);

      if (!uid || !requested.has(uid)) {
        continue;
      }

      byUid.set(uid, profile);
    }

    return requestedUids
      .map((uid) => byUid.get(uid) ?? null)
      .filter((profile): profile is IUserDados => profile !== null);
  }

  private normalizeUidList(
    uids: string[] | null | undefined
  ): string[] {
    return Array.from(
      new Set(
        (uids ?? [])
          .map((uid) => this.toCleanText(uid))
          .filter((uid): uid is string => uid !== null)
      )
    );
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private buildKnownQueryCacheKey(
    kind: string,
    values: readonly string[]
  ): string {
    const encodedValues = values.map((value) =>
      encodeURIComponent(value.trim().toLowerCase())
    );

    return `${UserDiscoveryQueryService.SENSITIVE_CACHE_PREFIX}query:${kind}:${encodedValues.join('|')}`;
  }

  private scopeCacheKey(baseKey: string, authUid: string): string {
    return `${baseKey}:viewer=${encodeURIComponent(authUid)}`;
  }

  private firstText(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): string | null {
    for (const key of keys) {
      const text = this.toCleanText(source[key]);

      if (text) {
        return text;
      }
    }

    return null;
  }

  private firstValue<T = unknown>(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): T | null {
    for (const key of keys) {
      const value = source[key];

      if (value !== undefined && value !== null) {
        return value as T;
      }
    }

    return null;
  }

  private firstNumber(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): number | null {
    const value = this.firstValue(source, keys);
    const numberValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private firstStringArray(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): readonly string[] | null {
    for (const key of keys) {
      const value = source[key];

      if (!Array.isArray(value)) {
        continue;
      }

      const items = Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      );

      if (items.length) {
        return items;
      }
    }

    return null;
  }

  private toCleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();
    return text.length ? text : null;
  }
}
