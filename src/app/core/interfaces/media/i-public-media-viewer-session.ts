import type { IPublicMediaContinuationContext } from './i-public-media-continuation-context';
import type { IPublicProfileMediaItem } from './i-public-profile-media-item';

export type TPublicMediaViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
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

export function isPublicMediaViewerHandoffResult(
  value: unknown
): value is IPublicMediaViewerHandoffResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<IPublicMediaViewerHandoffResult>;
  return candidate.kind === 'mixed-handoff' &&
    (candidate.direction === 'previous' || candidate.direction === 'next');
}
