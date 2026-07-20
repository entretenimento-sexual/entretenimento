// functions/src/account_lifecycle/account-shared-publication-anonymization.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR SHARED PUBLICATION ANONYMIZATION
// -----------------------------------------------------------------------------
// Comentários e respostas em fotos de terceiros permanecem legíveis, mas perdem
// identificadores diretos. Likes próprios são removidos com métricas consistentes.
// Denúncias e evidências não pertencem a este domínio.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  type MediaScoreBreakdown,
} from '../media/application/media-engagement-score';
import type { AccountSharedPublicationAnonymizationAdapter } from './account-shared-publication-anonymization.executor';

interface PhotoCommentDocument {
  authorUid?: unknown;
  authorNickname?: unknown;
  authorPhotoURL?: unknown;
  authorAvatarUrl?: unknown;
  replyToAuthorUid?: unknown;
  replyToAuthorNickname?: unknown;
}

interface PhotoReactionDocument {
  uid?: unknown;
}

interface PublicPhotoDocument {
  ownerUid?: unknown;
  reactionsCount?: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  ratingsCount?: unknown;
  ratingAverage?: unknown;
  scoreBreakdown?: Partial<MediaScoreBreakdown> | null;
}

interface PublicPhotoInteractionPath {
  ownerUid: string;
  photoId: string;
}

const DELETED_USER_LABEL = 'Usuário excluído';

export class FirestoreAccountSharedPublicationAnonymizationAdapter
implements AccountSharedPublicationAnonymizationAdapter
{
  async anonymizePhotoCommentAuthorsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collectionGroup('comments')
      .where('authorUid', '==', safeUid)
      .limit(limit)
      .get();

    for (const commentSnapshot of snapshot.docs) {
      await anonymizeCommentAuthor(safeUid, commentSnapshot);
    }

    return snapshot.size;
  }

  async anonymizePhotoCommentReplyTargetsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collectionGroup('comments')
      .where('replyToAuthorUid', '==', safeUid)
      .limit(limit)
      .get();

    for (const commentSnapshot of snapshot.docs) {
      await anonymizeCommentReplyTarget(safeUid, commentSnapshot);
    }

    return snapshot.size;
  }

  async deletePhotoReactionReferencesPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collectionGroup('likes')
      .where('uid', '==', safeUid)
      .limit(limit)
      .get();

    for (const reactionSnapshot of snapshot.docs) {
      await deletePhotoReactionReference(safeUid, reactionSnapshot);
    }

    return snapshot.size;
  }
}

async function anonymizeCommentAuthor(
  uid: string,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  resolvePublicPhotoInteractionPath(snapshot.ref.path, 'comments');

  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(snapshot.ref);
    if (!currentSnapshot.exists) return;

    const comment = currentSnapshot.data() as PhotoCommentDocument;
    if (normalizeId(comment.authorUid) !== uid) return;

    const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      authorUid: deletedUserReference(uid),
      authorNickname: DELETED_USER_LABEL,
      authorIdentityState: 'pseudonymized_after_account_deletion',
      identityUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (Object.prototype.hasOwnProperty.call(comment, 'authorPhotoURL')) {
      patch['authorPhotoURL'] = null;
    }

    if (Object.prototype.hasOwnProperty.call(comment, 'authorAvatarUrl')) {
      patch['authorAvatarUrl'] = null;
    }

    transaction.update(snapshot.ref, patch);
  });
}

async function anonymizeCommentReplyTarget(
  uid: string,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  resolvePublicPhotoInteractionPath(snapshot.ref.path, 'comments');

  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(snapshot.ref);
    if (!currentSnapshot.exists) return;

    const comment = currentSnapshot.data() as PhotoCommentDocument;
    if (normalizeId(comment.replyToAuthorUid) !== uid) return;

    transaction.update(snapshot.ref, {
      replyToAuthorUid: deletedUserReference(uid),
      replyToAuthorNickname: DELETED_USER_LABEL,
      replyTargetIdentityState: 'pseudonymized_after_account_deletion',
      identityUpdatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function deletePhotoReactionReference(
  uid: string,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const path = resolvePublicPhotoInteractionPath(snapshot.ref.path, 'likes');
  const photoRef = db.doc(
    `public_profiles/${path.ownerUid}/public_photos/${path.photoId}`
  );

  await db.runTransaction(async (transaction) => {
    const [currentReactionSnapshot, photoSnapshot] = await Promise.all([
      transaction.get(snapshot.ref),
      transaction.get(photoRef),
    ]);

    if (!currentReactionSnapshot.exists) return;

    const reaction = currentReactionSnapshot.data() as PhotoReactionDocument;
    if (normalizeId(reaction.uid) !== uid) return;

    transaction.delete(snapshot.ref);

    if (!photoSnapshot.exists) return;

    const photo = photoSnapshot.data() as PublicPhotoDocument;
    const storedOwnerUid = normalizeId(photo.ownerUid);

    if (storedOwnerUid && storedOwnerUid !== path.ownerUid) {
      throw new Error('inconsistent-public-photo-owner');
    }

    const currentReactions = normalizeMediaCount(
      photo.reactionsCount ?? photo.likesCount
    );
    const nextReactions = Math.max(0, currentReactions - 1);
    const score = buildMediaEngagementScore({
      reactionsCount: nextReactions,
      commentsCount: normalizeMediaCount(photo.commentsCount),
      ratingsCount: normalizeMediaCount(photo.ratingsCount),
      ratingAverage: photo.ratingAverage,
      currentBreakdown: photo.scoreBreakdown,
    });

    transaction.update(photoRef, {
      reactionsCount: nextReactions,
      likesCount: nextReactions,
      engagementScore: score.engagementScore,
      score: score.score,
      scoreBreakdown: score.scoreBreakdown,
      updatedAt: Date.now(),
    });
  });
}

function resolvePublicPhotoInteractionPath(
  rawPath: string,
  expectedCollection: 'comments' | 'likes'
): PublicPhotoInteractionPath {
  const segments = String(rawPath ?? '').split('/');
  const valid =
    segments.length === 6 &&
    segments[0] === 'public_profiles' &&
    isSafeId(segments[1]) &&
    segments[2] === 'public_photos' &&
    isSafeId(segments[3]) &&
    segments[4] === expectedCollection &&
    isSafeId(segments[5]);

  if (!valid) {
    throw new Error('unexpected-shared-publication-path');
  }

  return {
    ownerUid: segments[1]!,
    photoId: segments[3]!,
  };
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return isSafeId(normalized) ? normalized : null;
}

function isSafeId(value: unknown): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(String(value ?? ''));
}

function requireUid(value: unknown): string {
  const uid = normalizeId(value);
  if (!uid) {
    throw new Error('UID inválido para anonimização de publicações.');
  }
  return uid;
}

function deletedUserReference(uid: string): string {
  const key = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `deleted:${key}`;
}
