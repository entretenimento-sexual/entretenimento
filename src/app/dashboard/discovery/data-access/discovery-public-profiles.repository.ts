// src/app/dashboard/discovery/data-access/discovery-public-profiles.repository.ts
// -----------------------------------------------------------------------------
// Repositório paginado da Discovery V2.
//
// A listagem passa exclusivamente pela fronteira backend-time
// getPublicProfilesPage. O cliente não decide elegibilidade temporal.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { EMPTY, Observable, concat, of, throwError } from 'rxjs';
import { switchMap, take, tap } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

import {
  CachedDiscoveryFeedPage,
  DiscoveryFeedCursor,
  DiscoveryFeedPage,
  DiscoveryFeedRequest,
  buildDiscoveryFeedPageCacheKey,
  normalizeDiscoveryCursor,
  normalizeDiscoveryRequest,
} from '../models/discovery-feed-page.model';
import { PublicProfileCard } from '../models/public-profile-card.model';
import { mapPublicProfileCard } from './public-profile-card.mapper';

const DISCOVERY_PAGE_CACHE_TTL_MS = 60_000;

interface GetPublicProfilesPageRequest {
  readonly mode: 'all' | 'compatible';
  readonly pageSize: number;
  readonly cursor: DiscoveryFeedCursor | null;
}

interface GetPublicProfilesPageResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: DiscoveryFeedCursor | null;
  readonly reachedEnd: boolean;
  readonly fetchedAt: number;
  readonly scanned: number;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryPublicProfilesRepository {
  private readonly functions = inject(Functions);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly cache = inject(CacheService);

  private readonly getPublicProfilesPageCallable = httpsCallable<
    GetPublicProfilesPageRequest,
    GetPublicProfilesPageResponse
  >(this.functions, 'getPublicProfilesPage');

  loadPage$(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null = null
  ): Observable<DiscoveryFeedPage> {
    const normalizedRequest = normalizeDiscoveryRequest(request);
    const normalizedCursor = normalizeDiscoveryCursor(cursor);

    if (!normalizedRequest) {
      return throwError(
        () => new Error('[DiscoveryPublicProfilesRepository] consulta inválida')
      );
    }

    const cacheKey = buildDiscoveryFeedPageCacheKey(
      normalizedRequest,
      normalizedCursor
    );

    const server$ = this.fetchServerPage$(
      normalizedRequest,
      normalizedCursor
    ).pipe(
      tap((page) => {
        const cachedPage: CachedDiscoveryFeedPage = {
          items: page.items,
          nextCursor: page.nextCursor,
          reachedEnd: page.reachedEnd,
          fetchedAt: page.fetchedAt,
        };

        this.cache.set(
          cacheKey,
          cachedPage,
          DISCOVERY_PAGE_CACHE_TTL_MS,
          { persist: true }
        );
      })
    );

    return this.cache.get<CachedDiscoveryFeedPage>(cacheKey).pipe(
      take(1),
      switchMap((cached) =>
        concat(
          cached
            ? of<DiscoveryFeedPage>({
                ...cached,
                source: 'cache',
              })
            : EMPTY,
          server$
        )
      )
    );
  }

  private fetchServerPage$(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null
  ): Observable<DiscoveryFeedPage> {
    return this.firestoreContext.deferPromise$(async () => {
      const response = await this.getPublicProfilesPageCallable({
        mode: request.mode,
        pageSize: request.pageSize,
        cursor,
      });

      const payload = response.data;
      const items = (payload.items ?? [])
        .map((raw) => mapPublicProfileCard(raw))
        .filter((item): item is PublicProfileCard => item !== null);
      const nextCursor = normalizeDiscoveryCursor(payload.nextCursor);

      return {
        items,
        nextCursor,
        reachedEnd: payload.reachedEnd === true || nextCursor === null,
        source: 'server' as const,
        fetchedAt:
          Number.isFinite(payload.fetchedAt) && payload.fetchedAt > 0
            ? Math.trunc(payload.fetchedAt)
            : Date.now(),
      };
    });
  }
}
