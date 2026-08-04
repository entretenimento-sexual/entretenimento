import type { UserRecord } from 'firebase-admin/auth';
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { auth, db } from '../../firebaseApp';
import {
  assertVideoAudienceAccessDecision,
  evaluateVideoAccountAccess,
  evaluateVideoAudienceAccess,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

interface AuthAccessSnapshot {
  readonly disabled: boolean;
  readonly emailVerified: boolean;
}

export interface AuthorizedVideoInteraction {
  readonly videoRef: DocumentReference;
  readonly publicationRef: DocumentReference;
  readonly publicVideo: PublicVideoAudienceDocument &
    Readonly<Record<string, unknown>>;
  readonly publication: VideoPublicationAudienceDocument &
    Readonly<Record<string, unknown>>;
}

export interface VideoInteractionAccessAuthorizer {
  assertInTransaction(
    transaction: Transaction,
    videoId: unknown
  ): Promise<AuthorizedVideoInteraction>;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function authSnapshot(user: UserRecord): AuthAccessSnapshot {
  return {
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
  };
}

async function readAuthUser(
  uid: string,
  missingMessage: string
): Promise<UserRecord> {
  try {
    return await auth.getUser(uid);
  } catch {
    throw new HttpsError('not-found', missingMessage);
  }
}

function snapshotRecord(
  snapshot: DocumentSnapshot
): Readonly<Record<string, unknown>> | null {
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data();
  return data && typeof data === 'object'
    ? data as Readonly<Record<string, unknown>>
    : null;
}

function isActiveBlock(snapshot: DocumentSnapshot | null): boolean {
  if (!snapshot?.exists) {
    return false;
  }

  return (snapshot.data() as RelationshipDocument | undefined)?.isBlocked ===
    true;
}

function isValidFriendEdge(
  snapshot: DocumentSnapshot | null,
  expectedFriendUid: string
): boolean {
  if (!snapshot?.exists) {
    return false;
  }

  const relationship = snapshot.data() as RelationshipDocument | undefined;
  return cleanId(relationship?.friendUid ?? snapshot.id) === expectedFriendUid;
}

export async function createVideoInteractionAccessAuthorizer(params: {
  readonly viewerUid: unknown;
  readonly ownerUid: unknown;
  readonly authenticatedEmailVerified?: boolean;
}): Promise<VideoInteractionAccessAuthorizer> {
  const viewerUid = cleanId(params.viewerUid);
  const ownerUid = cleanId(params.ownerUid);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (!ownerUid) {
    throw new HttpsError('invalid-argument', 'Perfil do vídeo inválido.');
  }

  const viewerAuthUser = await readAuthUser(
    viewerUid,
    'Conta do usuário não encontrada.'
  );
  const ownerAuthUser = ownerUid === viewerUid
    ? viewerAuthUser
    : await readAuthUser(ownerUid, 'Perfil responsável pelo vídeo não encontrado.');
  const viewerAuth = authSnapshot(viewerAuthUser);
  const ownerAuth = authSnapshot(ownerAuthUser);

  return {
    assertInTransaction: async (
      transaction: Transaction,
      rawVideoId: unknown
    ): Promise<AuthorizedVideoInteraction> => {
      const videoId = cleanId(rawVideoId);

      if (!videoId) {
        throw new HttpsError('invalid-argument', 'Vídeo inválido.');
      }

      const viewerRef = db.doc(`users/${viewerUid}`);
      const ownerRef = db.doc(`users/${ownerUid}`);
      const videoRef = db.doc(
        `public_profiles/${ownerUid}/public_videos/${videoId}`
      );
      const publicationRef = db.doc(
        `users/${ownerUid}/video_publications/${videoId}`
      );
      const viewerUserPromise = transaction.get(viewerRef);
      const ownerUserPromise = ownerUid === viewerUid
        ? viewerUserPromise
        : transaction.get(ownerRef);
      const viewerBlockPromise = ownerUid === viewerUid
        ? Promise.resolve<DocumentSnapshot | null>(null)
        : transaction.get(
          db.doc(`users/${viewerUid}/blocks/${ownerUid}`)
        );
      const ownerBlockPromise = ownerUid === viewerUid
        ? Promise.resolve<DocumentSnapshot | null>(null)
        : transaction.get(
          db.doc(`users/${ownerUid}/blocks/${viewerUid}`)
        );

      const [
        viewerSnapshot,
        ownerSnapshot,
        videoSnapshot,
        publicationSnapshot,
        viewerBlockSnapshot,
        ownerBlockSnapshot,
      ] = await Promise.all([
        viewerUserPromise,
        ownerUserPromise,
        transaction.get(videoRef),
        transaction.get(publicationRef),
        viewerBlockPromise,
        ownerBlockPromise,
      ]);
      const publicVideo = snapshotRecord(videoSnapshot);
      const publication = snapshotRecord(publicationSnapshot);
      const target = resolveCanonicalVideoAudienceTarget({
        ownerUid,
        videoId,
        action: 'INTERACT',
        publicVideo,
        publication,
      });

      if (!target || !publicVideo || !publication) {
        assertVideoAudienceAccessDecision(
          { allowed: false, reason: 'invalid_target' },
          'INTERACT'
        );
        throw new HttpsError('failed-precondition', 'Vídeo inconsistente.');
      }

      const viewerDecision = evaluateVideoAccountAccess(
        snapshotRecord(viewerSnapshot),
        viewerUid,
        {
          authDisabled: viewerAuth.disabled,
          authenticatedEmailVerified:
            params.authenticatedEmailVerified === true ||
            viewerAuth.emailVerified,
        }
      );
      const ownerDecision = evaluateVideoAccountAccess(
        snapshotRecord(ownerSnapshot),
        ownerUid,
        {
          authDisabled: ownerAuth.disabled,
          authenticatedEmailVerified: ownerAuth.emailVerified,
          requireVerifiedEmail: false,
        }
      );
      const viewerBlockedOwner = isActiveBlock(viewerBlockSnapshot);
      const ownerBlockedViewer = isActiveBlock(ownerBlockSnapshot);
      let bilateralFriendship = false;

      if (
        ownerUid !== viewerUid &&
        String(target.visibility ?? '').trim().toUpperCase() === 'FRIENDS' &&
        !viewerBlockedOwner &&
        !ownerBlockedViewer
      ) {
        const [viewerFriend, ownerFriend] = await Promise.all([
          transaction.get(
            db.doc(`users/${viewerUid}/friends/${ownerUid}`)
          ),
          transaction.get(
            db.doc(`users/${ownerUid}/friends/${viewerUid}`)
          ),
        ]);
        bilateralFriendship =
          isValidFriendEdge(viewerFriend, ownerUid) &&
          isValidFriendEdge(ownerFriend, viewerUid);
      }

      const accessDecision = evaluateVideoAudienceAccess({
        viewerUid,
        ownerUid,
        action: 'INTERACT',
        visibility: target.visibility,
        isPublished: target.isPublished,
        moderationStatus: target.moderationStatus,
        viewerLifecycleAllowed: viewerDecision.allowed,
        ownerLifecycleAllowed: ownerDecision.allowed,
        viewerBlockedOwner,
        ownerBlockedViewer,
        bilateralFriendship,

        // Compatibilidade e assinatura por criador ainda não possuem projeções
        // canônicas neste fluxo. A política permanece fechada por padrão.
        mutuallyCompatible: false,
        hasCreatorSubscriberEntitlement: false,
        hasCreatorPremiumEntitlement: false,
      });

      assertVideoAudienceAccessDecision(accessDecision, 'INTERACT');

      return {
        videoRef,
        publicationRef,
        publicVideo: publicVideo as PublicVideoAudienceDocument &
          Readonly<Record<string, unknown>>,
        publication: publication as VideoPublicationAudienceDocument &
          Readonly<Record<string, unknown>>,
      };
    },
  };
}
