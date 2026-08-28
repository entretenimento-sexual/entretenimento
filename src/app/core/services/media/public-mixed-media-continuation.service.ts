import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import {
  IPublicProfileMediaItem,
  isPublicPhotoItem,
  isPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { composePublicProfileMediaPriority } from 'src/app/core/utils/media/public-profile-media-priority';
import { PublicPhotoContinuationService } from './public-photo-continuation.service';
import {
  IPublicMediaRecentViewCandidate,
  PublicMediaRecentViewService,
} from './public-media-recent-view.service';
import { PublicVideoContinuationService } from './public-video-continuation.service';

export interface PublicMixedMediaContinuationRequest {
  readonly existingItems: readonly IPublicProfileMediaItem[];
  readonly source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
  readonly limit?: number;
  readonly continuationContext?: IPublicMediaContinuationContext;
}

export interface PublicMixedMediaContinuationResult {
  readonly items: readonly IPublicProfileMediaItem[];
  readonly exhausted: boolean;
  readonly failed: boolean;
  readonly degraded: boolean;
}

const DEFAULT_CONTINUATION_LIMIT = 8;
const MAX_CONTINUATION_LIMIT = 12;
const CANDIDATE_LIMIT_PER_TYPE = 12;
const MAX_CONSECUTIVE_SAME_TYPE = 2;

@Injectable({ providedIn: 'root' })
export class PublicMixedMediaContinuationService {
  constructor(
    private readonly authSession: AuthSessionService,
    private readonly photoContinuation: PublicPhotoContinuationService,
    private readonly videoContinuation: PublicVideoContinuationService,
    private readonly recentViews: PublicMediaRecentViewService
  ) {}

  loadContinuation$(
    request: PublicMixedMediaContinuationRequest
  ): Observable<PublicMixedMediaContinuationResult> {
    const limit = this.normalizeLimit(request.limit);
    const existingItems = this.normalizeExistingItems(request.existingItems);
    const existingPhotos = existingItems.filter(isPublicPhotoItem);
    const existingVideos = existingItems.filter(isPublicVideoItem);

    return this.authSession.uid$.pipe(
      take(1),
      switchMap((viewerUid) => {
        const excludeOwnerUid = String(viewerUid ?? '').trim();

        return combineLatest([
          this.photoContinuation.loadContinuation$({
            existingItems: existingPhotos,
            source: request.source,
            excludeOwnerUid,
            limit: CANDIDATE_LIMIT_PER_TYPE,
            continuationContext: request.continuationContext,
          }),
          this.videoContinuation.loadContinuation$({
            existingItems: existingVideos,
            source: request.source,
            excludeOwnerUid,
            limit: CANDIDATE_LIMIT_PER_TYPE,
            continuationContext: request.continuationContext,
          }),
        ]).pipe(
          switchMap(([photoResult, videoResult]) => {
            const candidates = this.mergeCandidates(
              photoResult.items,
              videoResult.items,
              existingItems
            );
            const sourceFailed = photoResult.failed || videoResult.failed;
            const sourceDegraded =
              sourceFailed ||
              photoResult.degraded === true ||
              videoResult.degraded === true;

            if (!candidates.length) {
              return of({
                items: [],
                failed: sourceFailed,
                exhausted: !sourceFailed,
                degraded: sourceDegraded,
              });
            }

            if (!excludeOwnerUid) {
              return of(this.buildResult(
                candidates,
                [],
                request.continuationContext,
                limit,
                sourceFailed,
                sourceDegraded,
                false
              ));
            }

            return this.recentViews.resolveRecentViewedKeys$(
              this.buildRecentViewCandidates(candidates),
              { propagateErrors: true }
            ).pipe(
              map((recentViewedKeys) => this.buildResult(
                candidates,
                recentViewedKeys,
                request.continuationContext,
                limit,
                sourceFailed,
                sourceDegraded,
                false
              )),
              catchError(() => of(this.buildResult(
                candidates,
                [],
                request.continuationContext,
                limit,
                sourceFailed,
                sourceDegraded,
                true
              )))
            );
          })
        );
      })
    );
  }

  private buildResult(
    candidates: readonly IPublicProfileMediaItem[],
    recentViewedKeys: readonly string[],
    continuationContext: IPublicMediaContinuationContext | undefined,
    limit: number,
    sourceFailed: boolean,
    sourceDegraded: boolean,
    noveltyFailed: boolean
  ): PublicMixedMediaContinuationResult {
    const items = composePublicProfileMediaPriority(candidates, {
      connectionOwnerUids: continuationContext?.connectionOwnerUids ?? [],
      compatibleOwnerUids: continuationContext?.compatibleOwnerUids ?? [],
      recentViewedKeys,
      limit,
      maxConsecutiveSameType: MAX_CONSECUTIVE_SAME_TYPE,
    });
    const degraded = sourceDegraded || noveltyFailed;

    return {
      items,
      failed: items.length === 0 && sourceFailed,
      exhausted: items.length === 0 && !sourceFailed,
      degraded,
    };
  }

  private mergeCandidates(
    photos: readonly IPublicProfileMediaItem[],
    videos: readonly IPublicProfileMediaItem[],
    existingItems: readonly IPublicProfileMediaItem[]
  ): IPublicProfileMediaItem[] {
    const excluded = new Set(
      existingItems.map((item) => this.mediaKey(item)).filter(Boolean)
    );
    const unique = new Map<string, IPublicProfileMediaItem>();

    for (const item of [...photos, ...videos]) {
      const key = this.mediaKey(item);
      if (!key || excluded.has(key) || unique.has(key)) {
        continue;
      }

      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private normalizeExistingItems(
    items: readonly IPublicProfileMediaItem[]
  ): IPublicProfileMediaItem[] {
    const unique = new Map<string, IPublicProfileMediaItem>();

    for (const item of items ?? []) {
      const key = this.mediaKey(item);
      if (!key || unique.has(key)) continue;
      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private buildRecentViewCandidates(
    items: readonly IPublicProfileMediaItem[]
  ): IPublicMediaRecentViewCandidate[] {
    const result: IPublicMediaRecentViewCandidate[] = [];

    for (const item of items) {
      const ownerUid = String(item.ownerUid ?? '').trim();
      const mediaId = String(item.id ?? '').trim();
      if (!ownerUid || !mediaId) continue;

      result.push({
        mediaType: isPublicVideoItem(item) ? 'VIDEO' : 'PHOTO',
        ownerUid,
        mediaId,
      });
    }

    return result;
  }

  private mediaKey(item: IPublicProfileMediaItem): string {
    return buildPublicMediaIdentity(
      isPublicVideoItem(item) ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value ?? DEFAULT_CONTINUATION_LIMIT);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_CONTINUATION_LIMIT;
    }

    return Math.min(
      MAX_CONTINUATION_LIMIT,
      Math.max(1, Math.trunc(parsed))
    );
  }
}
