import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  fromEvent,
  merge,
  of,
  timer,
} from 'rxjs';
import {
  auditTime,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import {
  VIDEO_OWNER_ACCESS_REFRESH_MS,
  VideoLibraryService,
} from 'src/app/core/services/media/video-library.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { ProfileVideoLibraryActions } from './profile-video-library.actions';
import {
  IProfileVideoViewItem,
  type IProfileVideoStoredItem,
  toEphemeralVideoItem,
} from './profile-video-library.models';
import { profileVideoLibraryFeature } from './profile-video-library.reducer';

/** Pequeno agrupamento para várias entradas de IntersectionObserver no mesmo frame. */
export const PRIVATE_VIDEO_PREVIEW_BATCH_DELAY_MS = 75;

export function selectNearbyPrivateVideos(
  items: readonly IProfileVideoStoredItem[],
  nearbyVideoIds: ReadonlySet<string>
): IProfileVideoStoredItem[] {
  // Metadados limitados a 60 itens no backend; nunca solicitar item desconhecido.
  return items.filter((item) => nearbyVideoIds.has(item.video.id)).slice(0, 60);
}

@Injectable()
export class ProfileVideoLibraryFacade {
  private readonly store = inject(Store);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly document = inject(DOCUMENT);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private activeOwnerUid: string | null = null;
  private readonly nearbyVideoIdsSubject =
    new BehaviorSubject<ReadonlySet<string>>(new Set());

  readonly status$ = this.store.select(profileVideoLibraryFeature.selectStatus);
  readonly errorMessage$ = this.store.select(
    profileVideoLibraryFeature.selectErrorMessage
  );

  /** Timer existe apenas com UI inscrita e somente enquanto a aba está visível. */
  private readonly visibleRefresh$ = merge(
    of(null),
    fromEvent(this.document, 'visibilitychange')
  ).pipe(
    map(() => this.document.visibilityState !== 'hidden'),
    distinctUntilChanged(),
    switchMap((visible) =>
      visible
        ? timer(0, VIDEO_OWNER_ACCESS_REFRESH_MS).pipe(map(() => true))
        : of(false)
    )
  );

  readonly viewItems$: Observable<IProfileVideoViewItem[]> = combineLatest([
    this.store.select(profileVideoLibraryFeature.selectOwnerUid),
    this.store.select(profileVideoLibraryFeature.selectItems),
    this.nearbyVideoIdsSubject,
    this.visibleRefresh$,
  ]).pipe(
    auditTime(PRIVATE_VIDEO_PREVIEW_BATCH_DELAY_MS),
    switchMap(([ownerUid, storedItems, nearbyVideoIds, documentVisible]) => {
      const withoutAccess = storedItems.map((item) => ({
        video: toEphemeralVideoItem(item.video),
        publication: item.publication,
      }));

      if (!ownerUid || !documentVisible || storedItems.length === 0) {
        return of(withoutAccess);
      }

      const candidates = selectNearbyPrivateVideos(storedItems, nearbyVideoIds);
      if (candidates.length === 0) {
        return of(withoutAccess);
      }

      // Observabilidade apenas em debug opt-in, sem UID, vídeo, URL ou writes.
      this.privacyDebug.log('media', 'PrivateVideoLibrary: preview selection', {
        libraryCount: storedItems.length,
        nearbyCount: candidates.length,
        skippedCount: storedItems.length - candidates.length,
      });

      return this.videoLibrary.hydrateOwnedVideoPreviewAccess$(
        ownerUid,
        candidates.map((item) => toEphemeralVideoItem(item.video))
      ).pipe(
        map((hydratedVideos) => {
          const hydratedById = new Map(
            hydratedVideos.map((video) => [video.id, video])
          );

          return storedItems.map((item) => ({
            video:
              hydratedById.get(item.video.id) ??
              toEphemeralVideoItem(item.video),
            publication: item.publication,
          }));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setPreviewNearby(videoId: string, nearby: boolean): void {
    const id = String(videoId ?? '').trim();
    if (!id || !this.activeOwnerUid || id.length > 128) return;

    const current = this.nearbyVideoIdsSubject.value;
    if (current.has(id) === nearby) return;

    const next = new Set(current);
    if (nearby && next.size < 60) {
      next.add(id);
    } else if (!nearby) {
      next.delete(id);
    }
    this.nearbyVideoIdsSubject.next(next);
  }

  watchOwner(ownerUid: string | null): void {
    const normalized = String(ownerUid ?? '').trim() || null;

    if (normalized !== this.activeOwnerUid) {
      this.activeOwnerUid = normalized;
      this.nearbyVideoIdsSubject.next(new Set());
    }

    if (!normalized) {
      this.store.dispatch(ProfileVideoLibraryActions.watchStopped());
      return;
    }

    this.store.dispatch(
      ProfileVideoLibraryActions.watchRequested({ ownerUid: normalized })
    );
  }

  stop(): void {
    this.activeOwnerUid = null;
    this.nearbyVideoIdsSubject.next(new Set());
    this.store.dispatch(ProfileVideoLibraryActions.watchStopped());
  }
}
