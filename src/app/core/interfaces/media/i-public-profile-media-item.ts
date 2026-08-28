import type { IPublicPhotoItem } from './i-public-photo-item';
import type { IPublicVideoItem } from './i-public-video-item';

export type IPublicProfileMediaItem = IPublicPhotoItem | IPublicVideoItem;

export function isPublicVideoItem(
  item: IPublicProfileMediaItem
): item is IPublicVideoItem {
  return item.mediaType === 'VIDEO';
}

export function isPublicPhotoItem(
  item: IPublicProfileMediaItem
): item is IPublicPhotoItem {
  return item.mediaType !== 'VIDEO';
}
