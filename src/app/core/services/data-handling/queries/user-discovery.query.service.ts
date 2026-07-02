// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
// =============================================================================
// USER DISCOVERY QUERY SERVICE
// =============================================================================
//
// Responsabilidade:
// - consultar perfis pÃºblicos em public_profiles/{uid};
// - atender fluxos de descoberta, busca e hidrataÃ§Ã£o de cards;
// - nunca consultar users/{uid} para discovery pÃºblico;
// - proteger leituras contra execuÃ§Ã£o sem autenticaÃ§Ã£o;
// - usar cache sem aceitar cache raso/incompleto para cards.
//
// Ponto corrigido nesta versÃ£o:
// - getProfilesByUids$ nÃ£o aceita mais cache apenas por conter o UID;
// - o cache por UID sÃ³ Ã© usado se tiver dados pÃºblicos Ãºteis para card;
// - antes de consultar Firestore, tenta reaproveitar o cache geral
//   discovery:public_profiles:all, que costuma estar mais completo;
// - isso corrige a pane "LocalizaÃ§Ã£o nÃ£o informada" no modo Online quando
//   havia cache antigo sem municÃ­pio/estado/coordenadas.
//
// SeguranÃ§a:
// - lÃª apenas public_profiles;
// - nÃ£o expÃµe e-mail, telefone ou dados privados;
// - nÃ£o abre consulta sem sessÃ£o;
// - erros passam por FirestoreErrorHandlerService.
//
// ManutenÃ§Ã£o:
// - mantÃ©m os nomes dos mÃ©todos pÃºblicos atuais;
// - mantÃ©m Observable;
// - helpers pequenos e reaproveitÃ¡veis;
// - sem dependÃªncia de Router, Presence ou NgRx.
import { Injectable, DestroyRef, inject } from '@angular/core';
import { defer, forkJoin, from, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  QueryConstraint,
  documentId,
  where,
} from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly DISCOVERY_COL = 'public_profiles';

  /**
   * Firestore aceita lotes maiores para `in`, mas 10 Ã© conservador e estÃ¡vel.
   * Isso evita regressÃ£o caso algum ambiente/emulador esteja com limite antigo.
   */
  private static readonly UID_BATCH_SIZE = 10;

  private readonly uid$ = this.authSession.uid$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly read: FirestoreReadService,
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) {
    this.uid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (!uid) {
          /**
           * Ponto futuro:
           * se o CacheService ganhar clearByPrefix('discovery:'),
           * este Ã© o lugar certo para limpar cache sensÃ­vel Ã  sessÃ£o.
           */
        }
      });
  }

  // ===========================================================================
  // Helpers bÃ¡sicos
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

      if (!uid) {
        continue;
      }

      if (seen.has(uid)) {
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

  // ===========================================================================
  // ConversÃ£o public_profiles -> IUserDados pÃºblico
  // ===========================================================================

  /**
   * Converte public_profiles/{uid} para o formato que os cards entendem.
   *
   * Importante:
   * - nÃ£o adiciona dados privados;
   * - aceita aliases de campos usados em fases anteriores do projeto;
   * - preserva localizaÃ§Ã£o textual e geogrÃ¡fica quando existirem;
   * - nÃ£o define online real, pois isso vem de presence.
   */
  private toUserDadosFromPublicProfile(raw: any): IUserDados {
    const uid = this.firstText(raw, ['uid']) ?? '';

    const nickname = this.firstText(raw, ['nickname']);

    const latitude = this.toOptionalNumber(
      this.firstValue(raw, ['latitude', 'lat'])
    );

    const longitude = this.toOptionalNumber(
      this.firstValue(raw, ['longitude', 'lng', 'lon'])
    );

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

      role:
        this.firstText(raw, ['role']) ??
        'free',

      gender: this.firstText(raw, [
        'gender',
        'genero',
      ]),

      age:
        this.firstValue(raw, ['age', 'idade']) ??
        null,

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

      createdAt:
        this.firstValue(raw, ['createdAt']) ??
        null,

      updatedAt:
        this.firstValue(raw, ['updatedAt']) ??
        null,

      /**
       * Discovery nÃ£o define presenÃ§a.
       * O OnlineUsersEffects enriquece isso com presence/{uid}.
       */
      isOnline: false,
      lastSeen: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
    } as unknown as IUserDados;
  }

  // ===========================================================================
  // Cache helpers
  // ===========================================================================

  /**
   * Verifica se um public_profile cacheado Ã© Ãºtil para montar card.
   *
   * Antes, o cache era aceito apenas por conter UID.
   * Isso deixava passar objetos rasos, causando:
   * - "Perfil";
   * - "LocalizaÃ§Ã£o nÃ£o informada";
   * - latitude/longitude null;
   * - ausÃªncia de orientaÃ§Ã£o.
   *
   * Aqui exigimos UID + nickname e pelo menos algum metadado pÃºblico Ãºtil.
   */
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

  // ===========================================================================
  // Query helpers
  // ===========================================================================

  private onceGuardedQuery(
    constraints: QueryConstraint[] = [],
    options?: { cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const cacheTTL = options?.cacheTTL ?? 30_000;
    const cacheKey = `discovery:query:${JSON.stringify(
      constraints.map((item) => item.type ?? 'constraint')
    )}`;

    return this.uid$.pipe(
      take(1),

      switchMap((uid) => {
        if (!uid) {
          return of([] as IUserDados[]);
        }

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            if (cached?.length) {
              return of(cached);
            }

            return this.read
              .getDocumentsOnce<any>(this.DISCOVERY_COL, constraints, {
                useCache: true,
                cacheTTL,
                mapIdField: 'uid',
                requireAuth: true,
              })
              .pipe(
                map((docs) =>
                  (docs ?? []).map((doc) =>
                    this.toUserDadosFromPublicProfile(doc)
                  )
                ),

                map((users) => {
                  this.cache.set(cacheKey, users, cacheTTL);

                  return users;
                })
              );
          }),

          catchError((err) =>
            this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
              err,
              [],
              {
                silent: true,
                context: 'user-discovery.onceGuardedQuery',
              }
            )
          )
        );
      }),

      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ===========================================================================
  // API pÃºblica preservada
  // ===========================================================================

  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.onceGuardedQuery(constraints ?? [], {
      cacheTTL: 60_000,
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

    return this.searchUsers([
      where('gender', '==', g),
      where('orientation', '==', o),
      where('municipio', '==', m),
    ]);
  }
  getUsersByGender$(gender: string): Observable<IUserDados[]> {
    const clean = this.toCleanText(gender);

    if (!clean) {
      return of([] as IUserDados[]);
    }

    return this.onceGuardedQuery([
      where('gender', '==', clean),
    ]);
  }

  getUsersByOrientation$(orientation: string): Observable<IUserDados[]> {
    const clean = this.toCleanText(orientation);

    if (!clean) {
      return of([] as IUserDados[]);
    }

    return this.onceGuardedQuery([
      where('orientation', '==', clean),
    ]);
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

    return this.onceGuardedQuery(constraints);
  }

  getProfilesByUids$(
    uids: string[] | null | undefined,
    opts?: { cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const normalized = this.normalizeUidList(uids);

    if (!normalized.length) {
      return of([] as IUserDados[]);
    }

    const sorted = [...normalized].sort();
    const cacheTTL = opts?.cacheTTL ?? 30_000;

    const cacheKey = `discovery:public_profiles:uids:${sorted.join(',')}`;
    const allProfilesCacheKey = 'discovery:public_profiles:all';

    return this.uid$.pipe(
      take(1),

      switchMap((uid) => {
        if (!uid) {
          return of([] as IUserDados[]);
        }

        return forkJoin({
          cachedAll: this.cache.get<IUserDados[]>(allProfilesCacheKey).pipe(
            take(1),
            catchError(() => of(null))
          ),

          cachedByUids: this.cache.get<IUserDados[]>(cacheKey).pipe(
            take(1),
            catchError(() => of(null))
          ),
        }).pipe(
          switchMap(({ cachedAll, cachedByUids }) => {
            /**
             * Primeiro tenta o cache geral.
             *
             * Motivo:
             * - o modo Todos costuma carregar public_profiles completos;
             * - esse cache pode estar melhor do que o cache especÃ­fico por UID;
             * - se estiver completo, reaproveitamos e regravamos o cache por UID.
             */
            const fromAllCache = this.pickProfilesByRequestedUids(
              cachedAll,
              sorted
            );

            if (this.cachedProfilesCoverRequestedUids(fromAllCache, sorted)) {
              this.cache.set(cacheKey, fromAllCache, cacheTTL);

              return of(fromAllCache);
            }

            /**
             * Depois tenta o cache especÃ­fico.
             *
             * Agora ele sÃ³ Ã© aceito se tiver dados Ãºteis para card.
             */
            const fromUidCache = this.pickProfilesByRequestedUids(
              cachedByUids,
              sorted
            );

            if (this.cachedProfilesCoverRequestedUids(fromUidCache, sorted)) {
              return of(fromUidCache);
            }

            /**
             * Cache ausente ou raso: consulta Firestore.
             */
            const batches = this.chunk(
              sorted,
              UserDiscoveryQueryService.UID_BATCH_SIZE
            );

            const reads$ = batches.map((batch) =>
              this.onceGuardedQuery(
                [where(documentId(), 'in', batch)],
                { cacheTTL }
              )
            );

            return forkJoin(reads$).pipe(
              map((parts) => parts.flat()),

              map((profiles) => {
                const byUid = new Map<string, IUserDados>();

                for (const profile of profiles ?? []) {
                  const profileUid = (profile?.uid ?? '').trim();

                  if (!profileUid) {
                    continue;
                  }

                  byUid.set(profileUid, profile);
                }

                return sorted
                  .map((requestedUid) => byUid.get(requestedUid) ?? null)
                  .filter((profile): profile is IUserDados => !!profile);
              }),

              map((profiles) => {
                this.cache.set(cacheKey, profiles, cacheTTL);

                return profiles;
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
              )
            );
          }),

          catchError((err) =>
            this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
              err,
              [],
              {
                silent: true,
                context: 'user-discovery.getProfilesByUids$.cache',
              }
            )
          )
        );
      }),

      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getAllUsers$(): Observable<IUserDados[]> {
    const cacheKey = 'discovery:public_profiles:all';

    return this.uid$.pipe(
      take(1),

      switchMap((uid) => {
        if (!uid) {
          return of([] as IUserDados[]);
        }

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            /**
             * Para o feed geral, ainda aceitamos cache existente.
             * Se vocÃª quiser ser mais rÃ­gido depois, dÃ¡ para validar
             * `isPublicProfileUsableForCard()` aqui tambÃ©m, mas isso pode gerar
             * mais leituras em feed amplo.
             */
            if (cached?.length) {
              return of(cached);
            }

            return this.read
              .getDocumentsOnce<any>(this.DISCOVERY_COL, [], {
                useCache: true,
                cacheTTL: 300_000,
                mapIdField: 'uid',
                requireAuth: true,
              })
              .pipe(
                map((docs) =>
                  (docs ?? []).map((doc) =>
                    this.toUserDadosFromPublicProfile(doc)
                  )
                ),

                map((users) => {
                  this.cache.set(cacheKey, users, 600_000);

                  return users;
                })
              );
          }),

          catchError((err) => {
            this.firestoreError.handleFirestoreError(err);

            return of([] as IUserDados[]);
          })
        );
      }),

      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}

