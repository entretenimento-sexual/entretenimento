import type { IPublicPhotoItem } from './i-public-photo-item';

export type TPublicPhotoRankingMode = 'top' | 'latest' | 'boosted';

export interface IPublicPhotoRankingCursor {
  readonly mode: TPublicPhotoRankingMode;
  readonly score: number;
  readonly publishedAt: number;
  readonly boostedUntil?: number;
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
  readonly source: TPublicPhotoRankingMode;
  readonly items: readonly IPublicPhotoItem[];
  readonly nextCursor: IPublicPhotoRankingCursor | null;
  readonly hasMore: boolean;
  readonly loadedAt: number;
}
