import type { UserRecord } from 'firebase-admin/auth';
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  evaluateAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { auth, db } from '../../firebaseApp';
import {
  resolveCanonicalPhotoAudienceTarget,
  type PhotoPublicationAudienceDocument,
  type PublicPhotoAudienceDocument,
} from './photo-audience-access.policy';
import {
  assertVideoAudienceAccessDecision,
  evaluateVideoAudienceAccess,
} from './video-audience-access.policy';

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

interface AuthAccessSnapshot {
  readonly disabled: boolean;
  readonly emailVerified: boolean;
}

export interface AuthorizedPhotoInteraction {
  readonly photoRef: DocumentReference;
  readonly publicationRef: DocumentReference;
  readonly publicPhoto: PublicPhotoAudienceDocument &
    Readonly<Record<string, unknown>>;
  readonly publication: PhotoPublicationAudienceDocument &
    Readonly<Record<string, unknown>>;
}

export interface PhotoInteractionAccessAuthorizer {
  assertInTransaction(
    transaction: Transaction,
    photoId: unknown
  ): Promise<AuthorizedPhotoInteraction>;
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

export async function createPhotoInteractionAccessAuthorizer(params: {
  readonly viewerUid: unknown;
  readonly ownerUid: unknown;
  readonly authenticatedEmailVerified?: boolean;
}): Promise<PhotoInteractionAccessAuthorizer> {
  const viewerUid = cleanId(params.viewerUid);
  const ownerUid = cleanId(params.ownerUid);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (!ownerUid) {
    throw new HttpsError('invalid-argument', 'Perfil da foto inválido.');
  }

  const viewerAuthUser = await readAuthUser(
    viewerUid,
    'Conta do usuário não encontrada.'
  );
  const ownerAuthUser = ownerUid === viewerUid
    ? viewerAuthUser
    : await readAuthUser(ownerUid, 'Perfil responsável pela foto não encontrado.');
  const viewerAuth = authSnapshot(viewerAuthUser);
  const ownerAuth = authSnapshot(ownerAuthUser);

  return {
    assertInTransaction: async (
      transaction: Transaction,
      rawPhotoId: unknown
    ): Promise<AuthorizedPhotoInteraction> => {
      const photoId = cleanId(rawPhotoId);

      if (!photoId) {
        throw new HttpsError('invalid-argument', 'Foto inválida.');
      }

      const viewerRef = db.doc(`users/${viewerUid}`);
      const ownerRef = db.doc(`users/${ownerUid}`);
      const profileRef = db.doc(`public_profiles/${ownerUid}`);
      const photoRef = profileRef.collection('public_photos').doc(photoId);
      const publicationRef = db.doc(
        `users/${ownerUid}/photo_publications/${photoId}`
      );
      const viewerUserPromise = transaction.get(viewerRef);
      const ownerUserPromise = ownerUid === viewerUid
        ? viewerUserPromise
        : transaction.get(ownerRef);
      const viewerBlockPromise = ownerUid === viewerUid
        ? Promise.resolve<DocumentSnapshot | null>(null)
        : transaction.get(db.doc(`users/${viewerUid}/blocks/${ownerUid}`));
      const ownerBlockPromise = ownerUid === viewerUid
        ? Promise.resolve<DocumentSnapshot | null>(null)
        : transaction.get(db.doc(`users/${ownerUid}/blocks/${viewerUid}`));

      const [
        viewerSnapshot,
        ownerSnapshot,
        profileSnapshot,
        photoSnapshot,
        publicationSnapshot,
        viewerBlockSnapshot,
        ownerBlockSnapshot,
      ] = await Promise.all([
        viewerUserPromise,
        ownerUserPromise,
        transaction.get(profileRef),
        transaction.get(photoRef),
        transaction.get(publicationRef),
        viewerBlockPromise,
        ownerBlockPromise,
      ]);
      const publicPhoto = snapshotRecord(photoSnapshot);
      const publication = snapshotRecord(publicationSnapshot);
      const target = resolveCanonicalPhotoAudienceTarget({
        ownerUid,
        photoId,
        action: 'INTERACT',
        publicPhoto,
        publication,
      });

      if (!profileSnapshot.exists || !target || !publicPhoto || !publication) {
        assertVideoAudienceAccessDecision(
          { allowed: false, reason: 'invalid_target' },
          'INTERACT'
        );
        throw new HttpsError('failed-precondition', 'Foto inconsistente.');
      }

      const viewerDecision = evaluateAccountOperationalAccess(
        snapshotRecord(viewerSnapshot),
        viewerUid,
        {
          disabled: viewerAuth.disabled,
          emailVerified:
            params.authenticatedEmailVerified === true ||
            viewerAuth.emailVerified,
        }
      );
      const ownerDecision = evaluateAccountOperationalAccess(
        snapshotRecord(ownerSnapshot),
        ownerUid,
        ownerAuth,
        { requireVerifiedEmail: false }
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
          transaction.get(db.doc(`users/${viewerUid}/friends/${ownerUid}`)),
          transaction.get(db.doc(`users/${ownerUid}/friends/${viewerUid}`)),
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
        mutuallyCompatible: false,
        hasCreatorSubscriberEntitlement: false,
        hasCreatorPremiumEntitlement: false,
      });

      assertVideoAudienceAccessDecision(accessDecision, 'INTERACT');

      return {
        photoRef,
        publicationRef,
        publicPhoto: publicPhoto as PublicPhotoAudienceDocument &
          Readonly<Record<string, unknown>>,
        publication: publication as PhotoPublicationAudienceDocument &
          Readonly<Record<string, unknown>>,
      };
    },
  };
}
