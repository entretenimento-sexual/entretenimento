// functions/src/community/community-rate-limit.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY RATE LIMIT SERVICE
// -----------------------------------------------------------------------------
// Adapter do domínio Community sobre o limitador transacional backend já usado
// pela plataforma. Mantém reason/recommendedAction estruturados para o pipeline
// global de erros do Angular e preserva retryAfterMs para diagnóstico/UX futura.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

function normalizeRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof HttpsError)) return null;
  const details = error.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  const parsed = Math.trunc(Number(
    (details as Record<string, unknown>)['retryAfterMs']
  ));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function consumeCommunityRateLimit(input: {
  action: CommunityRateLimitAction;
  actorUid: string;
  cost?: number;
  now?: number;
}): Promise<void> {
  const actorUid = String(input.actorUid ?? '').trim();
  if (!actorUid) {
    throw new Error('Rate limit de Community requer actorUid válido.');
  }

  const policy = getCommunityRateLimitPolicy(input.action);

  try {
    await consumeBackendRateLimitQuota({
      action: policy.backendAction,
      subject: actorUid,
      cost: input.cost ?? 1,
      config: policy.config,
      message: policy.message,
      now: input.now,
    });
  } catch (error) {
    if (!(error instanceof HttpsError) || error.code !== 'resource-exhausted') {
      throw error;
    }

    const retryAfterMs = normalizeRetryAfterMs(error);
    throw new HttpsError(
      'resource-exhausted',
      policy.message,
      {
        reason: policy.reason,
        recommendedAction: 'retry_later',
        ...(retryAfterMs !== null ? { retryAfterMs } : {}),
      }
    );
  }
}
