import { Observable, defer, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import type { OpenPublicVideoViewerRequest } from '../public-video-viewer/public-video-viewer-launcher.service';
import type {
  IPublicProfileVideoCursor,
  IPublicProfileVideoPage,
} from 'src/app/core/services/media/public-profile-video-pagination.service';

export interface OwnerVideoGallerySelection {
  readonly items: IPublicVideoItem[];
  readonly startIndex: number;
  readonly nextCursor: IPublicProfileVideoCursor | null;
}

/**
 * The owner library and visitor gallery must use the same public viewer
 * contract. The selection cursor describes the next authorized profile page;
 * dropping it silently truncates owner playback at the loaded window.
 */
export function buildOwnerVideoViewerRequest(
  selection: OwnerVideoGallerySelection
): OpenPublicVideoViewerRequest {
  return {
    items: selection.items,
    startIndex: selection.startIndex,
    source: 'profile',
    profileContinuationCursor: selection.nextCursor,
  };
}

/**
 * Rebuild an owner's playable gallery from the canonical public read boundary.
 * Search up to 3 pages (72 records): the current owner library is capped at
 * 60, so older videos still open with navigable neighbors. Beyond this bound
 * a separately authorized individual lookup remains available.
 */
export function resolveOwnerVideoGallerySelection$(
  ownerUid: string,
  selectedId: string,
  loadPage: (cursor: IPublicProfileVideoCursor | null) =>
    Observable<IPublicProfileVideoPage>,
  loadSelected: () => Observable<IPublicVideoItem | null>
): Observable<OwnerVideoGallerySelection | null> {
  return defer(() => {
    const items: IPublicVideoItem[] = [];
    const seen = new Set<string>();

    const isAuthorized = (video: IPublicVideoItem | null | undefined) =>
      !!video &&
      video.ownerUid === ownerUid &&
      (video.visibility === 'PUBLIC' || video.visibility === 'FRIENDS') &&
      video.moderationStatus === 'APPROVED' &&
      !!video.id?.trim();

    const lookup = (): Observable<OwnerVideoGallerySelection | null> =>
      loadSelected().pipe(
        take(1),
        map((video) => isAuthorized(video) && video?.id === selectedId
          ? { items: [video], startIndex: 0, nextCursor: null }
          : null)
      );

    const visit = (
      cursor: IPublicProfileVideoCursor | null,
      pageCount: number
    ): Observable<OwnerVideoGallerySelection | null> =>
      loadPage(cursor).pipe(
        take(1),
        switchMap((page) => {
          for (const video of page.items) {
            if (!isAuthorized(video) || seen.has(video.id)) continue;
            seen.add(video.id);
            items.push(video);
          }

          const startIndex = items.findIndex(video => video.id === selectedId);
          if (startIndex !== -1) {
            return of({ items: [...items], startIndex,
              nextCursor: page.hasMore ? page.nextCursor : null });
          }

          const next = page.nextCursor;
          if (pageCount < 3 && page.hasMore && next &&
              next.documentId !== cursor?.documentId) {
            return visit(next, pageCount + 1);
          }
          return lookup();
        })
      );

    return visit(null, 1);
  });
}
