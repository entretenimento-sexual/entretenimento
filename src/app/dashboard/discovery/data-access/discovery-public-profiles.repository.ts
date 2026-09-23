// src/app/dashboard/discovery/data-access/discovery-public-profiles.repository.ts
// -----------------------------------------------------------------------------
// Repositório paginado da Discovery V2.
//
// A listagem passa exclusivamente pela fronteira backend-time canônica.
// O cliente não enumera public_profiles nem decide elegibilidade temporal.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';

import { EMPTY, Observable, concat, of, throwError } from 'rxjs';
import { map, switchMap, take, tap } from 'rxjs/operators';

import {
  PublicProfileReadBoundaryService,
} from 'src/app/core/services/discovery/public-profile-read-boundary.service';
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

@Injectable({ providedIn: 'root' })
export class DiscoveryPublicProfilesRepository {
  private readonly publicProfileRead = inject(
    PublicProfileReadBoundaryService
  );
  private readonly cache = inject(CacheService);

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
          this.resolveCacheTtl(page.items),
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
                items: this.filterCurrentAdultCards(cached.items),
                source: 'cache',
              })
            : EMPTY,
          server$
        )
      )
    );
  }

  private filterCurrentAdultCards(
    items: readonly PublicProfileCard[]
  ): readonly PublicProfileCard[] {
    const now = Date.now();

    return (items ?? []).filter((item) =>
      typeof item.ageEligibilityValidUntil === 'number' &&
      Number.isFinite(item.ageEligibilityValidUntil) &&
      item.ageEligibilityValidUntil > now
    );
  }

  private resolveCacheTtl(
    items: readonly PublicProfileCard[]
  ): number {
    const now = Date.now();
    const earliestAgeExpiry = (items ?? []).reduce<number | null>(
      (earliest, item) => {
        const expiresAt = item.ageEligibilityValidUntil;

        if (
          typeof expiresAt !== 'number' ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= now
        ) {
          return earliest;
        }

        return earliest === null || expiresAt < earliest
          ? expiresAt
          : earliest;
      },
      null
    );

    return Math.max(
      1,
      Math.min(
        DISCOVERY_PAGE_CACHE_TTL_MS,
        earliestAgeExpiry === null
          ? DISCOVERY_PAGE_CACHE_TTL_MS
          : earliestAgeExpiry - now
      )
    );
  }

  private fetchServerPage$(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null
  ): Observable<DiscoveryFeedPage> {
    return this.publicProfileRead.read$({
      mode: request.mode,
      pageSize: request.pageSize,
      cursor,
    }).pipe(
      map((payload) => {
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
      })
    );
  }
}
