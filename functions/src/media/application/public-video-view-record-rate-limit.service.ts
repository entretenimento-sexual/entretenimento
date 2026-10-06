import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import { PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG } from './public-media-rate-limit.config';

export async function consumePublicVideoViewRecordQuota(
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'public-media-view-record',
    subject: viewerUid,
    cost: 1,
    config: PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG,
    message: 'Muitas tentativas de registrar visualizações foram feitas em pouco tempo.',
    now,
  });
}
