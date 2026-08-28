import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import {
  IPublicVideoRankingCursor,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { MediaPublicQueryService } from './media-public-query.service';
import {
  IPublicMediaRecentViewCandidate,
  PublicMediaRecentViewService,
} from './public-media-recent-view.service';
import { PublicVideoRankingQueryService } from './public-video-ranking-query.service';

export interface PublicVideoContinuationRequest {
  readonly existingItems: readonly IPublicVideoItem[];
  readonly source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
  readonly excludeOwnerUid?: string | null;
  readonly limit?: number;
  readonly continuationContext?: IPublicMediaContinuationContext;
}

export interface PublicVideoContinuationResult {
  readonly items: readonly IPublicVideoItem[];
  readonly exhausted: boolean;
  readonly failed: boolean;
  readonly degraded?: boolean;
}

interface CandidateSourceResult {
  readonly items: readonly IPublicVideoItem[];
  readonly failed: boolean;
}

interface ContinuationCandidateContext {
  readonly globalItems: readonly IPublicVideoItem[];
  readonly personalizedItems: readonly IPublicVideoItem[];
  readonly connectionOwnerUids: readonly string[];
  readonly compatibleOwnerUids: readonly string[];
  readonly sourceFailed: boolean;
}

const DEFAULT_CONTINUATION_LIMIT = 8;
const MAX_CONTINUATION_LIMIT = 12;
const RANKING_PAGE_SIZE = 12;
const PERSONALIZED_PAGE_SIZE = 12;
const MAX_PAGES_PER_MODE = 2;
const MAX_CONNECTION_OWNERS = 24;
const MAX_COMPATIBLE_OWNERS = 6;
const MAX_PERSONALIZED_OWNERS = 30;

@Injectable({ providedIn: 'root' })
export class PublicVideoContinuationService {
  constructor(
    private readonly ranking: PublicVideoRankingQueryService,
    private readonly mediaQuery: MediaPublicQueryService,
    private readonly recentViews: PublicMediaRecentViewService
  ) {}

  loadContinuation$(
    request: PublicVideoContinuationRequest
  ): Observable<PublicVideoContinuationResult> {
    const limit = this.normalizeLimit(request.limit);
    const excludedKeys = new Set(
      request.existingItems
        .map((item) => this.videoKey(item))
        .filter(Boolean)
    );
    const excludeOwnerUid = String(request.excludeOwnerUid ?? '').trim();
    const [primaryMode, secondaryMode] = this.resolveModeOrder(request.source);
    const continuationContext = this.normalizeContinuationContext(
      request.continuationContext,
      excludeOwnerUid
    );

    return combineLatest([
      this.loadGlobalCandidates$(
        primaryMode,
        secondaryMode,
        excludedKeys,
        excludeOwnerUid
      ),
      this.loadPersonalizedCandidates$(
        continuationContext,
        excludedKeys,
        excludeOwnerUid
      ),
    ]).pipe(
      switchMap(([globalResult, personalizedResult]) => {
        const context: ContinuationCandidateContext = {
          globalItems: globalResult.items,
          personalizedItems: personalizedResult.items,
          connectionOwnerUids: continuationContext.connectionOwnerUids,
          compatibleOwnerUids: continuationContext.compatibleOwnerUids,
          sourceFailed: globalResult.failed || personalizedResult.failed,
        };
        const candidatePool = this.buildCandidatePool(context, excludedKeys);

        if (!candidatePool.length || !excludeOwnerUid) {
          return of(this.buildResult(
            candidatePool,
            [],
            context,
            limit,
            false
          ));
        }

        return this.recentViews.resolveRecentViewedKeys$(
          this.buildRecentViewCandidates(candidatePool),
          { propagateErrors: true }
        ).pipe(
          map((recentViewedKeys) => this.buildResult(
            candidatePool,
            recentViewedKeys,
            context,
            limit,
            false
          )),
          catchError(() => of(this.buildResult(
            candidatePool,
            [],
            context,
            limit,
            true
          )))
        );
      })
    );
  }

  private loadGlobalCandidates$(
    primaryMode: TPublicVideoRankingMode,
    secondaryMode: TPublicVideoRankingMode,
    excludedKeys: ReadonlySet<string>,
    excludeOwnerUid: string
  ): Observable<CandidateSourceResult> {
    return combineLatest([
      this.loadFreshModePage$(
        primaryMode,
        excludedKeys,
        excludeOwnerUid,
        null,
        MAX_PAGES_PER_MODE
      ),
      this.loadFreshModePage$(
        secondaryMode,
        excludedKeys,
        excludeOwnerUid,
        null,
        MAX_PAGES_PER_MODE
      ),
    ]).pipe(
      map(([primaryResult, secondaryResult]) => ({
        items: this.mergeCandidates(
          primaryResult ?? [],
          secondaryResult ?? [],
          excludedKeys,
          MAX_CONTINUATION_LIMIT * 2
        ),
        failed: primaryResult === null || secondaryResult === null,
      }))
    );
  }

  private loadPersonalizedCandidates$(
    context: IPublicMediaContinuationContext,
    excludedKeys: ReadonlySet<string>,
    excludeOwnerUid: string
  ): Observable<CandidateSourceResult> {
    const ownerUids = [
      ...context.connectionOwnerUids,
      ...context.compatibleOwnerUids,
    ].slice(0, MAX_PERSONALIZED_OWNERS);

    if (!ownerUids.length) {
      return of({ items: [], failed: false });
    }

    return this.mediaQuery.getRecentPublicVideoPreviewsByOwners$(
      ownerUids,
      PERSONALIZED_PAGE_SIZE,
      { propagateErrors: true }
    ).pipe(
      map((items) => ({
        items: (items ?? []).filter((item) => {
          const key = this.videoKey(item);
          return !!key &&
            !excludedKeys.has(key) &&
            (!excludeOwnerUid || item.ownerUid !== excludeOwnerUid);
        }),
        failed: false,
      })),
      catchError(() => of({ items: [], failed: true }))
    );
  }

  private loadFreshModePage$(
    mode: TPublicVideoRankingMode,
    excludedKeys: ReadonlySet<string>,
    excludeOwnerUid: string,
    cursor: IPublicVideoRankingCursor | null,
    remainingPages: number
  ): Observable<IPublicVideoItem[] | null> {
    return this.ranking.loadPage$({
      mode,
      pageSize: RANKING_PAGE_SIZE,
      cursor,
      propagateErrors: true,
    }).pipe(
      switchMap((page) => {
        const fresh = page.items.filter((item) => {
          const key = this.videoKey(item);
          return !!key &&
            !excludedKeys.has(key) &&
            (!excludeOwnerUid || item.ownerUid !== excludeOwnerUid);
        });

        if (
          fresh.length > 0 ||
          remainingPages <= 1 ||
          !page.hasMore ||
          !page.nextCursor
        ) {
          return of(fresh);
        }

        return this.loadFreshModePage$(
          mode,
          excludedKeys,
          excludeOwnerUid,
          page.nextCursor,
          remainingPages - 1
        );
      }),
      catchError(() => of(null))
    );
  }

  private buildResult(
    candidatePool: readonly IPublicVideoItem[],
    recentViewedKeys: readonly string[],
    context: ContinuationCandidateContext,
    limit: number,
    noveltyFailed: boolean
  ): PublicVideoContinuationResult {
    const items = this.composePriority(
      candidatePool,
      context.connectionOwnerUids,
      context.compatibleOwnerUids,
      recentViewedKeys,
      limit
    );
    const degraded = context.sourceFailed || noveltyFailed;

    return {
      items,
      failed: items.length === 0 && context.sourceFailed,
      exhausted: items.length === 0 && !context.sourceFailed,
      degraded,
    };
  }

  private buildCandidatePool(
    context: ContinuationCandidateContext,
    excludedKeys: ReadonlySet<string>
  ): IPublicVideoItem[] {
    const unique = new Map<string, IPublicVideoItem>();

    for (const item of [
      ...context.personalizedItems,
      ...context.globalItems,
    ]) {
      const key = this.videoKey(item);
      if (!key || excludedKeys.has(key) || unique.has(key)) continue;
      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private composePriority(
    candidates: readonly IPublicVideoItem[],
    connectionOwnerUids: readonly string[],
    compatibleOwnerUids: readonly string[],
    recentViewedKeys: readonly string[],
    limit: number
  ): IPublicVideoItem[] {
    const connectionOwners = new Set(connectionOwnerUids);
    const compatibleOwners = new Set(
      compatibleOwnerUids.filter((uid) => !connectionOwners.has(uid))
    );
    const recentKeys = new Set(recentViewedKeys);
    const orderByNovelty = (items: readonly IPublicVideoItem[]) => [
      ...items.filter((item) => !recentKeys.has(this.recentViewKey(item))),
      ...items.filter((item) => recentKeys.has(this.recentViewKey(item))),
    ];
    const connectionItems = orderByNovelty(
      candidates.filter((item) => connectionOwners.has(item.ownerUid))
    );
    const compatibleItems = orderByNovelty(
      candidates.filter((item) => compatibleOwners.has(item.ownerUid))
    );
    const globalItems = orderByNovelty(
      candidates.filter((item) =>
        !connectionOwners.has(item.ownerUid) &&
        !compatibleOwners.has(item.ownerUid)
      )
    );

    if (!connectionItems.length && !compatibleItems.length) {
      return globalItems.slice(0, limit);
    }

    if (!globalItems.length) {
      return this.interleavePersonalized(
        connectionItems,
        compatibleItems,
        limit
      );
    }

    const result: IPublicVideoItem[] = [];
    let connectionIndex = 0;
    let compatibleIndex = 0;
    let globalIndex = 0;
    let personalizedSlotIndex = 0;

    while (result.length < limit) {
      const hasConnection = connectionIndex < connectionItems.length;
      const hasCompatible = compatibleIndex < compatibleItems.length;
      const hasGlobal = globalIndex < globalItems.length;

      if (!hasConnection && !hasCompatible && !hasGlobal) break;

      const personalizedSlot =
        result.length % 3 === 0 && (hasConnection || hasCompatible);

      if (personalizedSlot) {
        const preferConnection = personalizedSlotIndex % 2 === 0;

        if (preferConnection && hasConnection) {
          result.push(connectionItems[connectionIndex++]);
        } else if (!preferConnection && hasCompatible) {
          result.push(compatibleItems[compatibleIndex++]);
        } else if (hasConnection) {
          result.push(connectionItems[connectionIndex++]);
        } else if (hasCompatible) {
          result.push(compatibleItems[compatibleIndex++]);
        }

        personalizedSlotIndex += 1;
        continue;
      }

      if (hasGlobal) {
        result.push(globalItems[globalIndex++]);
        continue;
      }

      const remaining = this.interleavePersonalized(
        connectionItems.slice(connectionIndex),
        compatibleItems.slice(compatibleIndex),
        limit - result.length
      );
      result.push(...remaining);
      break;
    }

    return result.slice(0, limit);
  }

  private interleavePersonalized(
    connectionItems: readonly IPublicVideoItem[],
    compatibleItems: readonly IPublicVideoItem[],
    limit: number
  ): IPublicVideoItem[] {
    const result: IPublicVideoItem[] = [];
    const maxLength = Math.max(connectionItems.length, compatibleItems.length);

    for (let index = 0; index < maxLength && result.length < limit; index += 1) {
      const connection = connectionItems[index];
      const compatible = compatibleItems[index];
      if (connection && result.length < limit) result.push(connection);
      if (compatible && result.length < limit) result.push(compatible);
    }

    return result;
  }

  private buildRecentViewCandidates(
    items: readonly IPublicVideoItem[]
  ): IPublicMediaRecentViewCandidate[] {
    return items.flatMap((item) => {
      const ownerUid = String(item.ownerUid ?? '').trim();
      const mediaId = String(item.id ?? '').trim();
      return ownerUid && mediaId
        ? [{ mediaType: 'VIDEO' as const, ownerUid, mediaId }]
        : [];
    });
  }

  private mergeCandidates(
    primaryItems: readonly IPublicVideoItem[],
    secondaryItems: readonly IPublicVideoItem[],
    excludedKeys: ReadonlySet<string>,
    limit: number
  ): IPublicVideoItem[] {
    const result: IPublicVideoItem[] = [];
    const seen = new Set(excludedKeys);
    const maxLength = Math.max(primaryItems.length, secondaryItems.length);

    for (let index = 0; index < maxLength && result.length < limit; index += 1) {
      for (const item of [primaryItems[index], secondaryItems[index]]) {
        const key = item ? this.videoKey(item) : '';

        if (!item || !key || seen.has(key) || result.length >= limit) {
          continue;
        }

        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }

  private normalizeContinuationContext(
    context: IPublicMediaContinuationContext | undefined,
    excludeOwnerUid: string
  ): IPublicMediaContinuationContext {
    const connectionOwnerUids = this.normalizeOwnerUids(
      context?.connectionOwnerUids ?? [],
      MAX_CONNECTION_OWNERS,
      excludeOwnerUid
    );
    const connectionSet = new Set(connectionOwnerUids);
    const compatibleOwnerUids = this.normalizeOwnerUids(
      context?.compatibleOwnerUids ?? [],
      MAX_COMPATIBLE_OWNERS,
      excludeOwnerUid
    ).filter((uid) => !connectionSet.has(uid));

    return { connectionOwnerUids, compatibleOwnerUids };
  }

  private normalizeOwnerUids(
    values: readonly string[],
    limit: number,
    excludeOwnerUid: string
  ): string[] {
    const unique = new Set<string>();

    for (const value of values ?? []) {
      const uid = String(value ?? '').trim();
      if (!uid || uid === excludeOwnerUid) continue;
      unique.add(uid);
      if (unique.size >= limit) break;
    }

    return [...unique];
  }

  private resolveModeOrder(
    source: PublicVideoContinuationRequest['source']
  ): [TPublicVideoRankingMode, TPublicVideoRankingMode] {
    return source === 'latest'
      ? ['latest', 'top']
      : ['top', 'latest'];
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value ?? DEFAULT_CONTINUATION_LIMIT);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_CONTINUATION_LIMIT;
    }

    return Math.min(MAX_CONTINUATION_LIMIT, Math.max(1, Math.floor(parsed)));
  }

  private recentViewKey(item: IPublicVideoItem): string {
    return buildPublicMediaIdentity('VIDEO', item.ownerUid, item.id);
  }

  private videoKey(item: IPublicVideoItem | null | undefined): string {
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const videoId = String(item?.id ?? '').trim();
    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
  }
}
