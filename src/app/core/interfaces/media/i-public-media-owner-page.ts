import type { IPublicPhotoItem } from './i-public-photo-item';
import type { IPublicVideoItem } from './i-public-video-item';

export type TPublicMediaOwnerPageKind = 'PHOTO' | 'VIDEO';

export interface IPublicMediaOwnerCursor {
  readonly kind: TPublicMediaOwnerPageKind;
  readonly publishedAt: number;
  readonly documentPath: string;
}

export interface IPublicMediaOwnerPageRequest {
  readonly ownerUids: readonly string[];
  readonly pageSize?: number;
  readonly cursor?: IPublicMediaOwnerCursor | null;
  readonly notifyOnError?: boolean;
}

export interface IPublicMediaOwnerPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: IPublicMediaOwnerCursor | null;
  readonly hasMore: boolean;
  readonly failed: boolean;
  readonly loadedAt: number;
}

export type IPublicPhotoOwnerPage = IPublicMediaOwnerPage<IPublicPhotoItem>;
export type IPublicVideoOwnerPage = IPublicMediaOwnerPage<IPublicVideoItem>;
