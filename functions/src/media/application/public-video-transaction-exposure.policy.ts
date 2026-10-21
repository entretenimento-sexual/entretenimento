import { HttpsError } from 'firebase-functions/v2/https';

import {
  isCurrentPublicMediaAssetExposure,
} from './public-media-exposure.policy';

/**
 * A replay or analytics token does not override a newly restricted publication.
 * Both snapshots must be read inside the caller's Firestore transaction.
 * Signed URL issuance uses the same canonical exposure policy.
 */
export function assertCurrentPublicVideoTransactionExposure(input: {
  publicVideo: Record<string, unknown> | null | undefined;
  publication: Record<string, unknown> | null | undefined;
  nowMs: number;
}): void {
  if (!isCurrentPublicMediaAssetExposure({
    publicMedia: input.publicVideo,
    publication: input.publication,
    ownerExposureAllowed: true,
    nowMs: input.nowMs,
    allowedVisibilities: ['PUBLIC'],
  })) {
    throw new HttpsError('not-found', 'Vídeo público não encontrado.');
  }
}
