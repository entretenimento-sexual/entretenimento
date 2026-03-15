// src/app/core/services/data-handling/queries/user-discovery.query.service.ts
// Serviço de consulta para descoberta de usuários no Firestore
// Não esqueça os comentários
import { Injectable, DestroyRef, inject } from '@angular/core';
import { defer, from, Observable, of, forkJoin } from 'rxjs';
import {
  catchError,
  switchMap,
  map,
  distinctUntilChanged,
  shareReplay,
  take,
  filter,
} from 'rxjs/operators';
import { QueryConstraint, where, documentId } from 'firebase/firestore';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

/**
 * =============================================================================
 * USER DISCOVERY QUERY (Read / filtros de busca)
 * - Queries one-shot para discovery/search (não é presence).
 * - Pode usar CacheService para evitar leituras repetidas.
 * - NÃO conhece Router, Presence, NgRx.
 * - UID vem do AuthSession (fonte da verdade): não inventa sessão.
 * - NÃO abre leitura sem sessão (evita rules/400 em boot deslogado).
 * - Erros: FirestoreErrorHandlerService (caminho central de observabilidade).
 *
 * Arquitetura:
 * - Discovery NÃO lê de `users` (dados privados).
 * - Discovery lê de `public_profiles/{uid}`.
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserDiscoveryQueryService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly DISCOVERY_COL = 'public_profiles';

  /**
   * Lote conservador.
   * Firestore aceita `in` com mais folga hoje, mas manter 10 aqui reduz risco
   * operacional e simplifica evolução futura.
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
          // Se depois você implementar clearByPrefix('discovery:'), este é o lugar.
        }
      });
  }

  // --------------------------------------------------------------------------
  // Helpers de compatibilidade (IUserDados)
  // --------------------------------------------------------------------------

  private toUserDadosFromPublicProfile(raw: any): IUserDados {
    const uid = (raw?.uid ?? '').toString().trim();

    return {
      uid,

      nickname: raw?.nickname ?? null,
      photoURL: raw?.photoURL ?? raw?.avatarUrl ?? null,

      role: raw?.role ?? 'basic',
      gender: raw?.gender ?? null,
      age: raw?.age ?? null,
      orientation: raw?.orientation ?? null,
      municipio: raw?.municipio ?? null,
      estado: raw?.estado ?? null,

      // Discovery não assume presença
      isOnline: false,
      lastSeen: null,
      lastOnlineAt: null,
      lastOfflineAt: null,

      latitude: raw?.latitude ?? null,
      longitude: raw?.longitude ?? null,
      geohash: raw?.geohash ?? null,

      // Campos úteis para regra de exposição
      emailVerified: raw?.emailVerified ?? null,
      profileCompleted: raw?.profileCompleted ?? null,
    } as unknown as IUserDados;
  }

  private normalizeUidList(uids: string[] | null | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const raw of uids ?? []) {
      const uid = (raw ?? '').trim();
      if (!uid) continue;
      if (seen.has(uid)) continue;
      seen.add(uid);
      out.push(uid);
    }

    return out;
  }

  private chunk<T>(list: T[], size: number): T[][] {
    if (!list.length || size <= 0) return [];
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) {
      out.push(list.slice(i, i + size));
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Guards internos
  // --------------------------------------------------------------------------

  private onceGuardedQuery(
    constraints: QueryConstraint[],
    opts?: { waitForAuth?: boolean; cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const safeConstraints = constraints ?? [];
    const waitForAuth = !!opts?.waitForAuth;
    const cacheTTL = opts?.cacheTTL ?? 60_000;

    const uidOnce$ = waitForAuth
      ? this.uid$.pipe(
          filter((uid): uid is string => !!uid),
          take(1)
        )
      : defer(() => from(this.authSession.whenReady())).pipe(
          take(1),
          switchMap(() => this.uid$.pipe(take(1)))
        );

    return uidOnce$.pipe(
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        return this.read
          .getDocumentsOnce<any>(
            this.DISCOVERY_COL,
            safeConstraints,
            {
              useCache: true,
              cacheTTL,
              mapIdField: 'uid',
              requireAuth: true,
            }
          )
          .pipe(
            map((docs) => (docs ?? []).map((d) => this.toUserDadosFromPublicProfile(d))),
            catchError((err) =>
              this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
                err,
                [],
                { silent: true, context: 'user-discovery.onceGuardedQuery' }
              )
            )
          );
      })
    );
  }

  // --------------------------------------------------------------------------
  // API pública (mantém nomenclaturas originais)
  // --------------------------------------------------------------------------

  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.onceGuardedQuery(constraints ?? [], { cacheTTL: 60_000 });
  }

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    const g = (gender ?? '').trim();
    const o = (orientation ?? '').trim();
    const m = (municipio ?? '').trim();
    if (!g || !o || !m) return of([] as IUserDados[]);

    return this.searchUsers([
      where('gender', '==', g),
      where('orientation', '==', o),
      where('municipio', '==', m),
    ]);
  }

  /**
   * Resolve perfis públicos por UID.
   *
   * Uso principal:
   * - presence => lista de UIDs online
   * - discovery => materializa cards públicos consultáveis
   *
   * Estratégia:
   * - normaliza/deduplica UIDs
   * - consulta em lotes conservadores
   * - cacheia por conjunto de UIDs para amortecer reemissões do presence
   */
  getProfilesByUids$(
    uids: string[] | null | undefined,
    opts?: { cacheTTL?: number }
  ): Observable<IUserDados[]> {
    const normalized = this.normalizeUidList(uids);
    if (!normalized.length) return of([] as IUserDados[]);

    const sorted = [...normalized].sort();
    const cacheTTL = opts?.cacheTTL ?? 30_000;
    const cacheKey = `discovery:public_profiles:uids:${sorted.join(',')}`;

    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([] as IUserDados[]);

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            if (Array.isArray(cached) && cached.length) {
              return of(cached);
            }

            const batches = this.chunk(sorted, UserDiscoveryQueryService.UID_BATCH_SIZE);

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
                for (const p of profiles ?? []) {
                  const uid = (p?.uid ?? '').trim();
                  if (!uid) continue;
                  byUid.set(uid, p);
                }

                return sorted
                  .map((uid) => byUid.get(uid) ?? null)
                  .filter((p): p is IUserDados => !!p);
              }),
              map((profiles) => {
                this.cache.set(cacheKey, profiles, cacheTTL);
                return profiles;
              }),
              catchError((err) =>
                this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
                  err,
                  [],
                  { silent: true, context: 'user-discovery.getProfilesByUids$' }
                )
              )
            );
          }),
          catchError((err) =>
            this.firestoreError.handleFirestoreErrorAndReturn<IUserDados[]>(
              err,
              [],
              { silent: true, context: 'user-discovery.getProfilesByUids$.cache' }
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
        if (!uid) return of([] as IUserDados[]);

        return this.cache.get<IUserDados[]>(cacheKey).pipe(
          switchMap((cached) => {
            if (cached?.length) return of(cached);

            return this.read
              .getDocumentsOnce<any>(this.DISCOVERY_COL, [], {
                useCache: true,
                cacheTTL: 300_000,
                mapIdField: 'uid',
              })
              .pipe(
                map((docs) => (docs ?? []).map((d) => this.toUserDadosFromPublicProfile(d))),
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
} // Linha 326, fim do user-discovery.query.service.ts
