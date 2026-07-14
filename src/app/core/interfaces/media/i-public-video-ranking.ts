import type {
  IPublicVideoItem,
  TPublicVideoViewSource,
} from './i-public-video-item';

export type TPublicVideoRankingMode = 'top' | 'latest';

export interface IPublicVideoRankingCursor {
  readonly mode: TPublicVideoRankingMode;
  readonly score: number;
  readonly uniqueViewersCount: number;
  readonly viewsCount: number;
  readonly publishedAt: number;
  readonly documentPath: string;
}

export interface IPublicVideoRankingRequest {
  readonly mode: TPublicVideoRankingMode;
  readonly pageSize?: number;
  readonly cursor?: IPublicVideoRankingCursor | null;
  readonly notifyOnError?: boolean;
}

export interface IPublicVideoRankingPage {
  readonly mode: TPublicVideoRankingMode;
  readonly source: TPublicVideoViewSource;
  readonly items: readonly IPublicVideoItem[];
  readonly nextCursor: IPublicVideoRankingCursor | null;
  readonly hasMore: boolean;
  readonly loadedAt: number;
}
