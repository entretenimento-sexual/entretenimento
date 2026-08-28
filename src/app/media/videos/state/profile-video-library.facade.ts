import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, of, timer } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';

import {
  VIDEO_OWNER_ACCESS_REFRESH_MS,
  VideoLibraryService,
} from 'src/app/core/services/media/video-library.service';
import { ProfileVideoLibraryActions } from './profile-video-library.actions';
import {
  IProfileVideoViewItem,
  toEphemeralVideoItem,
} from './profile-video-library.models';
import { profileVideoLibraryFeature } from './profile-video-library.reducer';

@Injectable()
export class ProfileVideoLibraryFacade {
  private readonly store = inject(Store);
  private readonly videoLibrary = inject(VideoLibraryService);

  readonly status$ = this.store.select(profileVideoLibraryFeature.selectStatus);
  readonly errorMessage$ = this.store.select(
    profileVideoLibraryFeature.selectErrorMessage
  );

  readonly viewItems$: Observable<IProfileVideoViewItem[]> = combineLatest([
    this.store.select(profileVideoLibraryFeature.selectOwnerUid),
    this.store.select(profileVideoLibraryFeature.selectItems),
    timer(0, VIDEO_OWNER_ACCESS_REFRESH_MS),
  ]).pipe(
    switchMap(([ownerUid, storedItems]) => {
      if (!ownerUid || storedItems.length === 0) {
        return of([] as IProfileVideoViewItem[]);
      }

      const metadata = storedItems.map((item) =>
        toEphemeralVideoItem(item.video)
      );

      return this.videoLibrary.hydrateOwnedVideoPreviewAccess$(
        ownerUid,
        metadata
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

  watchOwner(ownerUid: string | null): void {
    const normalized = String(ownerUid ?? '').trim();

    if (!normalized) {
      this.store.dispatch(ProfileVideoLibraryActions.watchStopped());
      return;
    }

    this.store.dispatch(
      ProfileVideoLibraryActions.watchRequested({ ownerUid: normalized })
    );
  }

  stop(): void {
    this.store.dispatch(ProfileVideoLibraryActions.watchStopped());
  }
}
