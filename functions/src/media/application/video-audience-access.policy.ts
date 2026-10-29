import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertNoActiveBilateralBlockInTransaction,
} from '../../friendship/application/bilateral-block-access.policy';
import {
  resolveSocialConnectionAccessInTransaction,
} from '../../friendship/application/social-connection-access.policy';

/**
 * Social audience is revalidated at the moment a transaction writes
 * playback, view or retention evidence. An earlier signed URL or token
 * never grants ongoing permission after a friendship is revoked.
 */
export async function assertVideoAudienceAccessInTransaction(
  tx: Transaction,
  viewerUid: string,
  ownerUid: string,
  visibility: unknown
): Promise<boolean> {
  if (visibility === 'PUBLIC') {
    await assertNoActiveBilateralBlockInTransaction(
      tx, viewerUid, ownerUid, 'Vídeo indisponível.'
    );
    return false;
  }
  if (visibility !== 'FRIENDS') {
    throw new HttpsError('not-found', 'Vídeo indisponível.');
  }
  if (viewerUid === ownerUid) return true;
  const connection = await resolveSocialConnectionAccessInTransaction(
    tx, viewerUid, ownerUid
  );
  if (connection.isBlocked || !connection.isFriend) {
    throw new HttpsError('not-found', 'Vídeo indisponível.');
  }
  return true;
}
