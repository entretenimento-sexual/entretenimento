import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertNoActiveBilateralBlockInTransaction,
} from '../../friendship/application/bilateral-block-access.policy';
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
  const normalizedVisibility = String(visibility ?? '').trim().toUpperCase();
  const viewerIsOwner = viewerUid === ownerUid;

  if (viewerIsOwner) {
    const allowed = canReadPublishedPhotoAudience({
      visibility: normalizedVisibility,
      viewerIsOwner: true,
      viewerIsFriend: false,
    });

    if (!allowed) {
      throw new HttpsError('not-found', unavailableMessage);
    }

    return { isFriend: false, isBlocked: false };
  }

  if (normalizedVisibility === 'PUBLIC') {
    await assertNoActiveBilateralBlockInTransaction(
      transaction,
      viewerUid,
      ownerUid,
      unavailableMessage
    );

    return { isFriend: false, isBlocked: false };
  }

  if (normalizedVisibility !== 'FRIENDS') {
    throw new HttpsError('not-found', unavailableMessage);
  }

  const socialAccess = await resolveSocialConnectionAccessInTransaction(
    transaction,
    viewerUid,
    ownerUid
  );

  if (socialAccess.isBlocked || !socialAccess.isFriend) {
    throw new HttpsError('not-found', unavailableMessage);
  }

  return socialAccess;
}

export async function assertPhotoCommentAccessInTransaction(
  transaction: Transaction,
  input: {
    viewerUid: string;
    ownerUid: string;
    visibility: unknown;
    commentsEnabled: unknown;
    commentsPolicy: unknown;
  },
  unavailableMessage = 'Foto indisponível.'
): Promise<void> {
  const viewerIsOwner = input.viewerUid === input.ownerUid;
  const visibility = String(input.visibility ?? '').trim().toUpperCase();
  const commentsPolicy = String(input.commentsPolicy ?? '').trim().toUpperCase();
  const needsFriendState =
    !viewerIsOwner &&
    (visibility === 'FRIENDS' || commentsPolicy === 'FRIENDS');

  let viewerIsFriend = false;

  if (needsFriendState) {
    const socialAccess = await resolveSocialConnectionAccessInTransaction(
      transaction,
      input.viewerUid,
      input.ownerUid
    );

    if (socialAccess.isBlocked) {
      throw new HttpsError('not-found', unavailableMessage);
    }

    viewerIsFriend = socialAccess.isFriend;
  } else if (!viewerIsOwner) {
    await assertNoActiveBilateralBlockInTransaction(
      transaction,
      input.viewerUid,
      input.ownerUid,
      unavailableMessage
    );
  }

  if (
    !canReadPublishedPhotoAudience({
      visibility,
      viewerIsOwner,
      viewerIsFriend,
    })
  ) {
    throw new HttpsError('not-found', unavailableMessage);
  }

  if (
    !canCommentOnPublishedPhoto({
      commentsEnabled: input.commentsEnabled,
      commentsPolicy,
      viewerIsOwner,
      viewerIsFriend,
    })
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A política atual da foto não permite este comentário.'
    );
  }
}
