import type { IPublicPhotoItem } from './i-public-photo-item';

export type TPublicPhotoRankingMode = 'top' | 'latest';

export interface IPublicPhotoRankingCursor {
  readonly mode: TPublicPhotoRankingMode;
  readonly score: number;
  readonly publishedAt: number;
  readonly documentPath: string;
}

export interface IPublicPhotoRankingRequest {
  readonly mode: TPublicPhotoRankingMode;
  readonly pageSize?: number;
  readonly cursor?: IPublicPhotoRankingCursor | null;
  readonly notifyOnError?: boolean;
  readonly propagateErrors?: boolean;
}

export interface IPublicPhotoRankingPage {
  readonly mode: TPublicPhotoRankingMode;
  readonly source: 'top' | 'latest';
  readonly items: readonly IPublicPhotoItem[];
  readonly nextCursor: IPublicPhotoRankingCursor | null;
  readonly hasMore: boolean;
  readonly loadedAt: number;
}
