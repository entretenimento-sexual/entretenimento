import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';

const PUBLIC_PHOTO_VIEW_RECORD_BURST_WINDOW_MS = 60 * 1000;
const PUBLIC_PHOTO_VIEW_RECORD_BURST_MAX = 60;
const PUBLIC_PHOTO_VIEW_RECORD_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_PHOTO_VIEW_RECORD_SUSTAINED_MAX = 360;

export async function consumePublicPhotoViewRecordQuota(
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'recordPhotoView',
    subject: viewerUid,
    cost: 1,
    config: {
      burstWindowMs: PUBLIC_PHOTO_VIEW_RECORD_BURST_WINDOW_MS,
      burstMax: PUBLIC_PHOTO_VIEW_RECORD_BURST_MAX,
      sustainedWindowMs: PUBLIC_PHOTO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_PHOTO_VIEW_RECORD_SUSTAINED_MAX,
    },
    message: 'Muitas tentativas de registrar visualizações foram feitas em pouco tempo.',
    now,
  });
}
