import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
  PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS,
  PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
  PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
} from './public-video-view-record-rate-limit';

export async function consumePublicVideoViewRecordQuota(
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'recordVideoView',
    subject: viewerUid,
    cost: 1,
    config: {
      burstWindowMs: PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
      sustainedWindowMs: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
    },
    message: 'Muitas tentativas de registrar visualizações foram feitas em pouco tempo.',
    now,
  });
}
