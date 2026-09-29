import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import { EMPTY, combineLatest, forkJoin, from, of } from 'rxjs';
import {
  catchError,
  ignoreElements,
  mergeMap,
  switchMap,
  tap,
} from 'rxjs/operators';

import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import { ProfileVideoLibraryActions } from './profile-video-library.actions';
import { toProfileVideoStoredItems } from './profile-video-library.models';

@Injectable()
export class ProfileVideoLibraryEffects {
  private readonly actions$ = inject(Actions);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly videoPublication = inject(VideoPublicationService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private readonly failedCleanupRequested = new Set<string>();
  private readonly legacyModerationNormalizationRequested = new Set<string>();

  readonly watch$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ProfileVideoLibraryActions.watchRequested,
        ProfileVideoLibraryActions.watchStopped
      ),
      switchMap((action) => {
        if (!('ownerUid' in action)) {
          return EMPTY;
        }

        const ownerUid = String(action.ownerUid ?? '').trim();

        if (!ownerUid) {
          return EMPTY;
        }

        return combineLatest([
          this.videoLibrary.watchOwnedVideoMetadata$(ownerUid),
          this.videoPublication.watchOwnVideoPublications$(ownerUid),
        ]).pipe(
          switchMap(([videos, publications]) => {
            const failedVideos = videos.filter(
              (video) => video.status === 'failed'
            );
            const visibleVideos = videos.filter(
              (video) => video.status !== 'failed'
            );
            const visibleVideoIds = new Set(
              visibleVideos.map((video) => video.id)
            );
            const legacyPendingVideoIds = publications
              .filter((publication) =>
                visibleVideoIds.has(publication.videoId) &&
                publication.isPublished === true &&
                publication.visibility === 'PUBLIC' &&
                publication.moderationStatus === 'PENDING_REVIEW'
              )
              .map((publication) => publication.videoId);
            const nextActions: Action[] = [
              ProfileVideoLibraryActions.snapshotReceived({
                ownerUid,
                items: toProfileVideoStoredItems(
                  visibleVideos,
                  publications
                ),
              }),
            ];

            if (failedVideos.length > 0) {
              nextActions.push(
                ProfileVideoLibraryActions.failedUploadsDetected({
                  ownerUid,
                  videoIds: failedVideos.map((video) => video.id),
                })
              );
            }

            if (legacyPendingVideoIds.length > 0) {
              nextActions.push(
                ProfileVideoLibraryActions.legacyPendingModerationDetected({
                  ownerUid,
                  videoIds: legacyPendingVideoIds,
                })
              );
            }

            return from(nextActions);
          }),
          catchError((error) => {
            const descriptor = this.mediaError.report(error, {
              operation: 'profileVideoLibrary.watch',
              reasonHint: 'video_library_load_failed',
              metadata: { hasOwnerUid: true },
            });
            return of(
              ProfileVideoLibraryActions.watchFailed({
                ownerUid,
                message: descriptor.userMessage,
              })
            );
          })
        );
      })
    )
  );

  readonly cleanupFailedUploads$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ProfileVideoLibraryActions.failedUploadsDetected),
        mergeMap(({ ownerUid, videoIds }) => {
          const pendingVideoIds = videoIds.filter((videoId) => {
            const key = this.videoKey(ownerUid, videoId);

            if (this.failedCleanupRequested.has(key)) {
              return false;
            }

            this.failedCleanupRequested.add(key);
            return true;
          });

          if (pendingVideoIds.length === 0) {
            return EMPTY;
          }

          let failedDeletions = 0;

          return forkJoin(
            pendingVideoIds.map((videoId) =>
              this.videoPublication
                .deleteProfileVideo$(ownerUid, videoId)
                .pipe(
                  catchError((error) => {
                    failedDeletions += 1;
                    this.failedCleanupRequested.delete(
                      this.videoKey(ownerUid, videoId)
                    );
                    this.mediaError.reportSilently(
                      error,
                      'profileVideoLibrary.cleanupFailedUpload',
                      undefined,
                      {
                        hasOwnerUid: true,
                        hasVideoId: true,
                      },
                      'video_failed_upload_cleanup_pending'
                    );
                    return of(null);
                  })
                )
            )
          ).pipe(
            tap(() => {
              if (failedDeletions > 0) {
                this.mediaError.reportReason(
                  'video_failed_upload_cleanup_pending',
                  {
                    operation: 'profileVideoLibrary.cleanupFailedUploads',
                    metadata: {
                      hasOwnerUid: true,
                      failedDeletions,
                    },
                  }
                );
              }
            }),
            ignoreElements()
          );
        })
      ),
    { dispatch: false }
  );

  readonly normalizeLegacyModeration$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ProfileVideoLibraryActions.legacyPendingModerationDetected),
        mergeMap(({ ownerUid, videoIds }) => {
          const pendingVideoIds = videoIds.filter((videoId) => {
            const key = this.videoKey(ownerUid, videoId);

            if (this.legacyModerationNormalizationRequested.has(key)) {
              return false;
            }

            this.legacyModerationNormalizationRequested.add(key);
            return true;
          });

          if (pendingVideoIds.length === 0) {
            return EMPTY;
          }

          return this.videoPublication
            .normalizeLegacyVideoModeration$(ownerUid, pendingVideoIds)
            .pipe(
              catchError(() => {
                pendingVideoIds.forEach((videoId) =>
                  this.legacyModerationNormalizationRequested.delete(
                    this.videoKey(ownerUid, videoId)
                  )
                );
                return EMPTY;
              }),
              ignoreElements()
            );
        })
      ),
    { dispatch: false }
  );

  readonly resetLocalTracking$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ProfileVideoLibraryActions.watchStopped),
        tap(() => {
          this.failedCleanupRequested.clear();
          this.legacyModerationNormalizationRequested.clear();
        })
      ),
    { dispatch: false }
  );

  private videoKey(ownerUid: string, videoId: string): string {
    return JSON.stringify([ownerUid, videoId]);
  }
}