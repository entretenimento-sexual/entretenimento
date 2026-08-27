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
  normalizeMediaRatingAverage,
  type MediaScoreBreakdown,
} from '../media/application/media-engagement-score';
import type {
  AccountSharedPublicationAnonymizationAdapter,
} from './account-shared-publication-anonymization.executor';

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

  async anonymizeCommunityFeedPostAuthorsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_user_posts')
      .doc(safeUid)
      .collection('items')
      .limit(limit)
      .get();

    for (const pointerSnapshot of snapshot.docs) {
      await anonymizeCommunityFeedPostAuthor(safeUid, pointerSnapshot);
    }

    return snapshot.size;
  }

  async anonymizeCommunityFeedCommentAuthorsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_user_comments')
      .doc(safeUid)
      .collection('items')
      .limit(limit)
      .get();

    for (const pointerSnapshot of snapshot.docs) {
      await anonymizeCommunityFeedCommentAuthor(safeUid, pointerSnapshot);
    }

    return snapshot.size;
  }

  async anonymizeCommunityFeedPostActionActorsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_user_actions')
      .doc(safeUid)
      .collection('items')
      .limit(limit)
      .get();

    for (const pointerSnapshot of snapshot.docs) {
      await anonymizeCommunityFeedPostActionActor(safeUid, pointerSnapshot);
    }

    return snapshot.size;
  }

  async deleteCommunityFeedReactionsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_user_reactions')
      .doc(safeUid)
      .collection('items')
      .limit(limit)
      .get();

    for (const pointerSnapshot of snapshot.docs) {
      await deleteCommunityFeedReaction(safeUid, pointerSnapshot);
    }

    return snapshot.size;
  }

  async deleteCommunityFeedRequestsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_requests')
      .where('actorUid', '==', safeUid)
      .limit(limit)
      .get();
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    if (!snapshot.empty) await batch.commit();
    return snapshot.size;
  }

  async anonymizeCommunityFeedAuditPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('community_feed_audit')
      .where('actorUid', '==', safeUid)
      .limit(limit)
      .get();
    const batch = db.batch();
    const actorReference = deletedUserReference(safeUid);

    snapshot.docs.forEach((document) => {
      batch.update(document.ref, {
        actorUid: actorReference,
        actorIdentityState: 'pseudonymized_after_account_deletion',
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
    if (!snapshot.empty) await batch.commit();
    return snapshot.size;
  }

  async deleteCommunityFeedUserState(uid: string): Promise<number> {
    const safeUid = requireUid(uid);
    const stateRef = db.collection('community_feed_user_state').doc(safeUid);
    const snapshot = await stateRef.get();
    if (!snapshot.exists) return 0;
    await stateRef.delete();
    return 1;
  }
}

async function anonymizeCommunityFeedPostAuthor(
  uid: string,
  pointerSnapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const pointer = pointerSnapshot.data() as {
    actorUid?: unknown;
    communityId?: unknown;
    postId?: unknown;
  };
  const communityId = normalizeId(pointer.communityId);
  const postId = normalizeId(pointer.postId);

  if (normalizeId(pointer.actorUid) !== uid || !communityId || !postId) {
    throw new Error('inconsistent-community-feed-user-pointer');
  }

  const postRef = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items')
    .doc(postId);
  const projectionRef = db
    .collection('community_public_feed')
    .doc(communityId)
    .collection('items')
    .doc(postId);
  const actorReference = deletedUserReference(uid);

  await db.runTransaction(async (transaction) => {
    const [currentPointer, postSnapshot, projectionSnapshot] = await Promise.all([
      transaction.get(pointerSnapshot.ref),
      transaction.get(postRef),
      transaction.get(projectionRef),
    ]);

    if (!currentPointer.exists) return;
    if (!postSnapshot.exists) {
      transaction.delete(pointerSnapshot.ref);
      return;
    }

    const post = postSnapshot.data() ?? {};
    if (normalizeId(post['actorUid']) !== uid) {
      throw new Error('inconsistent-community-feed-post-author');
    }

    const authorPatch = {
      label: DELETED_USER_LABEL,
      avatarUrl: null,
    };
    transaction.update(postRef, {
      actorUid: actorReference,
      author: authorPatch,
      authorIdentityState: 'pseudonymized_after_account_deletion',
      identityUpdatedAt: FieldValue.serverTimestamp(),
    });
    if (projectionSnapshot.exists) {
      transaction.update(projectionRef, {
        author: authorPatch,
        authorIdentityState: 'pseudonymized_after_account_deletion',
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.delete(pointerSnapshot.ref);
  });
}

async function anonymizeCommunityFeedPostActionActor(
  uid: string,
  pointerSnapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const pointer = pointerSnapshot.data() as {
    actorUid?: unknown;
    communityId?: unknown;
    postId?: unknown;
  };
  const communityId = normalizeId(pointer.communityId);
  const postId = normalizeId(pointer.postId);

  if (normalizeId(pointer.actorUid) !== uid || !communityId || !postId) {
    throw new Error('inconsistent-community-feed-action-pointer');
  }

  const postRef = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items')
    .doc(postId);
  const actorReference = deletedUserReference(uid);

  await db.runTransaction(async (transaction) => {
    const [currentPointer, postSnapshot] = await Promise.all([
      transaction.get(pointerSnapshot.ref),
      transaction.get(postRef),
    ]);

    if (!currentPointer.exists) return;
    if (postSnapshot.exists) {
      const post = postSnapshot.data() ?? {};
      if (normalizeId(post['actionedBy']) !== uid) {
        throw new Error('inconsistent-community-feed-post-action-actor');
      }
      transaction.update(postRef, {
        actionedBy: actorReference,
        actionActorIdentityState: 'pseudonymized_after_account_deletion',
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.delete(pointerSnapshot.ref);
  });
}

async function anonymizeCommunityFeedCommentAuthor(
  uid: string,
  pointerSnapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const pointer = pointerSnapshot.data() as {
    actorUid?: unknown;
    communityId?: unknown;
    postId?: unknown;
    commentId?: unknown;
  };
  const communityId = normalizeId(pointer.communityId);
  const postId = normalizeId(pointer.postId);
  const commentId = normalizeId(pointer.commentId);
  if (
    normalizeId(pointer.actorUid) !== uid
    || !communityId
    || !postId
    || !commentId
  ) {
    throw new Error('inconsistent-community-feed-comment-pointer');
  }

  const commentRef = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items')
    .doc(postId)
    .collection('comments')
    .doc(commentId);
  const actorReference = deletedUserReference(uid);

  await db.runTransaction(async (transaction) => {
    const [currentPointer, commentSnapshot] = await Promise.all([
      transaction.get(pointerSnapshot.ref),
      transaction.get(commentRef),
    ]);
    if (!currentPointer.exists) return;
    if (commentSnapshot.exists) {
      const comment = commentSnapshot.data() ?? {};
      if (normalizeId(comment['actorUid']) !== uid) {
        throw new Error('inconsistent-community-feed-comment-author');
      }
      transaction.update(commentRef, {
        actorUid: actorReference,
        author: {
          label: DELETED_USER_LABEL,
          avatarUrl: null,
        },
        authorIdentityState: 'pseudonymized_after_account_deletion',
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.delete(pointerSnapshot.ref);
  });
}

async function deleteCommunityFeedReaction(
  uid: string,
  pointerSnapshot: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
  const pointer = pointerSnapshot.data() as {
    actorUid?: unknown;
    communityId?: unknown;
    postId?: unknown;
  };
  const communityId = normalizeId(pointer.communityId);
  const postId = normalizeId(pointer.postId);
  if (normalizeId(pointer.actorUid) !== uid || !communityId || !postId) {
    throw new Error('inconsistent-community-feed-reaction-pointer');
  }

  const postRef = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items')
    .doc(postId);
  const projectionRef = db
    .collection('community_public_feed')
    .doc(communityId)
    .collection('items')
    .doc(postId);
  const reactionRef = postRef.collection('reactions').doc(uid);

  await db.runTransaction(async (transaction) => {
    const [currentPointer, postSnapshot, projectionSnapshot, reactionSnapshot] =
      await Promise.all([
        transaction.get(pointerSnapshot.ref),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(reactionRef),
      ]);

    if (!currentPointer.exists) return;
    if (reactionSnapshot.exists) {
      const reaction = reactionSnapshot.data() ?? {};
      if (normalizeId(reaction['actorUid']) !== uid) {
        throw new Error('inconsistent-community-feed-reaction-actor');
      }
      transaction.delete(reactionRef);

      if (postSnapshot.exists) {
        const post = postSnapshot.data() ?? {};
        const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
        const nextCount = Math.max(
          0,
          normalizeMediaCount(metrics['reactionCount']) - 1
        );
        transaction.update(postRef, { 'metrics.reactionCount': nextCount });
        if (projectionSnapshot.exists) {
          transaction.update(projectionRef, {
            'metrics.reactionCount': nextCount,
          });
        }
      }
    }
    transaction.delete(pointerSnapshot.ref);
  });
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
      ratingAverage: normalizeMediaRatingAverage(photo.ratingAverage),
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
