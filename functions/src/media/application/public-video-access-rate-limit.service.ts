import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS,
  PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS,
  PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS,
  PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS,
} from './public-video-access-rate-limit';

export async function consumePublicVideoAccessQuota(
  viewerUid: string,
  itemCount: number,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'getPublicVideoAccessUrls',
    subject: viewerUid,
    cost: itemCount,
    config: {
      burstWindowMs: PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS,
      sustainedWindowMs: PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS,
    },
    message: 'Muitos vídeos foram solicitados em pouco tempo.',
    now,
  });
}
