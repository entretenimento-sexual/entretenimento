import type {
  DocumentSnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../../firebaseApp';
import {
  assertCanonicalVideoAudienceContext,
  type VideoAudienceAuthContext,
} from '../../../media/application/video-audience-context.policy';
import type {
  PublicVideoAudienceDocument,
  VideoPublicationAudienceDocument,
} from '../../../media/application/video-audience-access.policy';
import {
  resolveStoredDirectMessagePublicVideoReference,
  type RequestedPublicVideoReference,
  type StoredDirectMessagePublicVideoReference,
} from '../domain/direct-message-public-video-reference.policy';

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

interface RelationshipContext {
  readonly viewerBlockedOwner: boolean;
  readonly ownerBlockedViewer: boolean;
  readonly bilateralFriendship: boolean;
}

type CanonicalRecord = Readonly<Record<string, unknown>>;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function snapshotRecord(
  snapshot: DocumentSnapshot
): CanonicalRecord | null {
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data();
  return data && typeof data === 'object'
    ? data as CanonicalRecord
    : null;
}

function isActiveBlock(snapshot: DocumentSnapshot | null): boolean {
  return !!snapshot?.exists &&
    (snapshot.data() as RelationshipDocument | undefined)?.isBlocked === true;
}

function isValidFriendEdge(
  snapshot: DocumentSnapshot,
  expectedFriendUid: string
): boolean {
  if (!snapshot.exists) {
    return false;
  }

  const relationship = snapshot.data() as RelationshipDocument | undefined;
  return cleanId(relationship?.friendUid ?? snapshot.id) === expectedFriendUid;
}

function visibilityOf(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function throwRecipientAccessError(error: unknown): never {
  const code = error instanceof HttpsError
    ? error.code
    : 'failed-precondition';
  const originalDetails = error instanceof HttpsError &&
    error.details &&
    typeof error.details === 'object'
    ? error.details as Readonly<Record<string, unknown>>
    : {};

  throw new HttpsError(
    code,
    'O destinatário não possui acesso a este vídeo.',
    {
      ...originalDetails,
      perspective: 'recipient',
    }
  );
}

async function readRelationshipContext(
  transaction: Transaction,
  viewerUid: string,
  ownerUid: string,
  requiresFriendship: boolean
): Promise<RelationshipContext> {
  if (viewerUid === ownerUid) {
    return {
      viewerBlockedOwner: false,
      ownerBlockedViewer: false,
      bilateralFriendship: false,
    };
  }

  const viewerBlockRef = db.doc(`users/${viewerUid}/blocks/${ownerUid}`);
  const ownerBlockRef = db.doc(`users/${ownerUid}/blocks/${viewerUid}`);
  const viewerFriendRef = db.doc(`users/${viewerUid}/friends/${ownerUid}`);
  const ownerFriendRef = db.doc(`users/${ownerUid}/friends/${viewerUid}`);
  const [viewerBlock, ownerBlock, viewerFriend, ownerFriend] =
    await Promise.all([
      transaction.get(viewerBlockRef),
      transaction.get(ownerBlockRef),
      requiresFriendship
        ? transaction.get(viewerFriendRef)
        : Promise.resolve<DocumentSnapshot | null>(null),
      requiresFriendship
        ? transaction.get(ownerFriendRef)
        : Promise.resolve<DocumentSnapshot | null>(null),
    ]);

  return {
    viewerBlockedOwner: isActiveBlock(viewerBlock),
    ownerBlockedViewer: isActiveBlock(ownerBlock),
    bilateralFriendship:
      !!viewerFriend &&
      !!ownerFriend &&
      isValidFriendEdge(viewerFriend, ownerUid) &&
      isValidFriendEdge(ownerFriend, viewerUid),
  };
}

export async function authorizeDirectVideoShareInTransaction(params: {
  readonly transaction: Transaction;
  readonly actorUid: string;
  readonly targetUid: string;
  readonly requested: RequestedPublicVideoReference;
  readonly actorUser: unknown;
  readonly targetUser: unknown;
  readonly actorAuth: VideoAudienceAuthContext;
  readonly targetAuth: VideoAudienceAuthContext;
  readonly ownerAuth: VideoAudienceAuthContext;
}): Promise<StoredDirectMessagePublicVideoReference> {
  const {
    transaction,
    actorUid,
    targetUid,
    requested,
    actorUser,
    targetUser,
    actorAuth,
    targetAuth,
    ownerAuth,
  } = params;
  const ownerUid = requested.ownerUid;
  const videoId = requested.videoId;
  const ownerRef = db.doc(`users/${ownerUid}`);
  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicVideoRef = publicProfileRef.collection('public_videos').doc(videoId);
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const ownerSnapshotPromise = ownerUid === actorUid || ownerUid === targetUid
    ? Promise.resolve<DocumentSnapshot | null>(null)
    : transaction.get(ownerRef);
  const [
    ownerSnapshot,
    publicProfileSnapshot,
    publicVideoSnapshot,
    publicationSnapshot,
  ] = await Promise.all([
    ownerSnapshotPromise,
    transaction.get(publicProfileRef),
    transaction.get(publicVideoRef),
    transaction.get(publicationRef),
  ]);
  const publicVideo = snapshotRecord(publicVideoSnapshot) as
    | (PublicVideoAudienceDocument & CanonicalRecord)
    | null;
  const publication = snapshotRecord(publicationSnapshot) as
    | (VideoPublicationAudienceDocument & CanonicalRecord)
    | null;
  const ownerUser = ownerUid === actorUid
    ? actorUser
    : ownerUid === targetUid
      ? targetUser
      : ownerSnapshot
        ? snapshotRecord(ownerSnapshot)
        : null;
  const requiresFriendship =
    visibilityOf(publicVideo?.visibility) === 'FRIENDS' ||
    visibilityOf(publication?.visibility) === 'FRIENDS';
  const [actorRelationship, targetRelationship] = await Promise.all([
    readRelationshipContext(
      transaction,
      actorUid,
      ownerUid,
      requiresFriendship
    ),
    readRelationshipContext(
      transaction,
      targetUid,
      ownerUid,
      requiresFriendship
    ),
  ]);

  assertCanonicalVideoAudienceContext({
    viewerUid: actorUid,
    ownerUid,
    videoId,
    action: 'SHARE',
    viewerUser: actorUser,
    ownerUser,
    viewerAuth: actorAuth,
    ownerAuth,
    publicVideo,
    publication,
    ...actorRelationship,
  });

  try {
    assertCanonicalVideoAudienceContext({
      viewerUid: targetUid,
      ownerUid,
      videoId,
      action: 'PLAY',
      viewerUser: targetUser,
      ownerUser,
      viewerAuth: targetAuth,
      ownerAuth,
      publicVideo,
      publication,
      ...targetRelationship,
    });
  } catch (error) {
    throwRecipientAccessError(error);
  }

  const storedReference = resolveStoredDirectMessagePublicVideoReference({
    requested,
    publicProfileExists: publicProfileSnapshot.exists,
    publicVideo: publicVideo ?? undefined,
    publication: publication ?? undefined,
    senderAuthorized: true,
    recipientAuthorized: true,
  });

  if (!storedReference) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo não está disponível para compartilhamento.'
    );
  }

  return storedReference;
}
