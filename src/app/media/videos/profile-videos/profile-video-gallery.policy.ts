import type { IProfileVideoViewItem } from '../state/profile-video-library.models';

/** Sorting is owned by the library (newest first); this policy only filters. */
export type ProfileVideoGalleryFilter = 'all' | 'published' | 'not-published';

export function canPlayPublishedVideo(item: IProfileVideoViewItem): boolean {
  return item.video.status === 'ready' &&
    item.publication?.isPublished === true &&
    item.publication?.visibility === 'PUBLIC' &&
    item.publication?.moderationStatus === 'APPROVED';
}

export function filterProfileVideoGallery(
  items: readonly IProfileVideoViewItem[],
  filter: ProfileVideoGalleryFilter
): IProfileVideoViewItem[] {
  if (filter === 'all') return [...items];
  return items.filter((item) =>
    filter === 'published'
      ? canPlayPublishedVideo(item)
      : !canPlayPublishedVideo(item)
  );
}
