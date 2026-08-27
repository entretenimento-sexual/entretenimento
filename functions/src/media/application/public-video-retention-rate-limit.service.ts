import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';

const RETENTION_BURST_WINDOW_MS = 60 * 1000;
const RETENTION_BURST_MAX = 24;
const RETENTION_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const RETENTION_SUSTAINED_MAX = 120;

export async function consumePublicVideoRetentionQuota(
  viewerUid: string,
  now = Date.now()
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'recordVideoRetention',
    subject: viewerUid,
    cost: 1,
    config: {
      burstWindowMs: RETENTION_BURST_WINDOW_MS,
      burstMax: RETENTION_BURST_MAX,
      sustainedWindowMs: RETENTION_SUSTAINED_WINDOW_MS,
      sustainedMax: RETENTION_SUSTAINED_MAX,
    },
    message: 'Muitas atualizações de progresso de vídeo foram feitas em pouco tempo.',
    now,
  });
}
