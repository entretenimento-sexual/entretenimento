import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  resolveSocialConnectionAccessInTransaction,
  type SingleSocialConnectionAccessResolution,
} from '../../friendship/application/social-connection-access.policy';

export type SupportedPhotoAudience = 'PUBLIC' | 'FRIENDS';

export function canReadPublishedPhotoAudience(input: {
  visibility: unknown;
  viewerIsOwner: boolean;
  viewerIsFriend: boolean;
}): boolean {
  const visibility = String(input.visibility ?? '').trim().toUpperCase();

  return visibility === 'PUBLIC' ||
    (visibility === 'FRIENDS' && (input.viewerIsOwner || input.viewerIsFriend));
}

export function canCommentOnPublishedPhoto(input: {
  commentsEnabled: unknown;
  commentsPolicy: unknown;
  viewerIsOwner: boolean;
  viewerIsFriend: boolean;
}): boolean {
  if (input.commentsEnabled !== true) return false;

  const policy = String(input.commentsPolicy ?? '').trim().toUpperCase();

  if (policy === 'EVERYONE') return true;
  if (policy === 'FRIENDS') {
    return input.viewerIsOwner || input.viewerIsFriend;
  }

  return false;
}

export async function resolvePhotoAudienceAccessInTransaction(
  transaction: Transaction,
  viewerUid: string,
  ownerUid: string,
  visibility: unknown,
  unavailableMessage = 'Foto indisponível.'
): Promise<SingleSocialConnectionAccessResolution> {
  const viewerIsOwner = viewerUid === ownerUid;

  if (viewerIsOwner) {
    const allowed = canReadPublishedPhotoAudience({
      visibility,
      viewerIsOwner: true,
      viewerIsFriend: false,
    });

    if (!allowed) {
      throw new HttpsError('not-found', unavailableMessage);
    }

    return { isFriend: false, isBlocked: false };
  }

  const socialAccess = await resolveSocialConnectionAccessInTransaction(
    transaction,
    viewerUid,
    ownerUid
  );

  if (
    socialAccess.isBlocked ||
    !canReadPublishedPhotoAudience({
      visibility,
      viewerIsOwner: false,
      viewerIsFriend: socialAccess.isFriend,
    })
  ) {
    throw new HttpsError('not-found', unavailableMessage);
  }

  return socialAccess;
}
