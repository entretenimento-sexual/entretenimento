import type { IPublicMediaContinuationContext } from './i-public-media-continuation-context';
import type { IPublicProfileMediaItem } from './i-public-profile-media-item';

export type TPublicMediaViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'unknown';

export type TPublicMediaViewerDirection = 'previous' | 'next';

export interface IPublicMediaViewerMixedNavigation {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export interface IPublicMediaViewerHandoffResult {
  readonly kind: 'mixed-handoff';
  readonly direction: TPublicMediaViewerDirection;
}

export interface OpenPublicMixedMediaViewerRequest {
  readonly items: readonly IPublicProfileMediaItem[];
  readonly selected: IPublicProfileMediaItem;
  readonly source: TPublicMediaViewSource;
  readonly continuationContext?: IPublicMediaContinuationContext;
}

