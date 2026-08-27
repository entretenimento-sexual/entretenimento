import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
  PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS,
  PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
  PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS,
} from './public-video-playback-session-rate-limit';

export async function consumePublicVideoPlaybackSessionStartQuota(
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'startPublicVideoPlaybackSession',
    subject: viewerUid,
    cost: 1,
    config: {
      burstWindowMs: PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
      sustainedWindowMs: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
    },
    message: 'Muitas sessões de reprodução foram iniciadas em pouco tempo.',
    now,
  });
}
