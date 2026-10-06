import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import { PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG } from './public-media-rate-limit.config';

export async function consumePublicVideoAccessQuota(
  viewerUid: string,
  itemCount: number,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'public-media-access-urls',
    subject: viewerUid,
    cost: itemCount,
    config: PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG,
    message: 'Muitos vídeos foram solicitados em pouco tempo.',
    now,
  });
}
