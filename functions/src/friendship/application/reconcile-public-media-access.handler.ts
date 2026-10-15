// Reconcile only the requested owner pair when a legacy media UI projection
// is missing. Canonical block documents remain the sole authorization source.
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { consumeBackendRateLimitQuota } from '../../shared/security/backend-rate-limit.service';
import type { BackendFixedWindowRateLimitConfig } from '../../shared/security/backend-fixed-window-rate-limit';
import { assertPlatformAccountAccessData } from '../../account_lifecycle/interaction-access.policy';
import { isBilateralPublicMediaAvailable } from './user-block-transition';

const RECONCILE_PUBLIC_MEDIA_ACCESS_LIMIT: BackendFixedWindowRateLimitConfig = {
  burstWindowMs: 60_000,
  burstMax: 16,
  sustainedWindowMs: 60 * 60_000,
  sustainedMax: 120,
};

function uid(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value : '';
}

export const reconcilePublicMediaAccess = onCall<{ ownerUid?: unknown }>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<{ reconciled: true }> => {
    const viewerUid = uid(request.auth?.uid);
    const ownerUid = uid(request.data?.ownerUid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Sessão necessária.');
    }
    if (!ownerUid || viewerUid === ownerUid) {
      throw new HttpsError('invalid-argument', 'Perfil inválido.');
    }

    await consumeBackendRateLimitQuota({
      action: 'reconcile-public-media-access',
      subject: viewerUid,
      config: RECONCILE_PUBLIC_MEDIA_ACCESS_LIMIT,
      message: 'Muitas solicitações. Tente novamente mais tarde.',
    });

    await reconcilePublicMediaAccessPair(viewerUid, ownerUid);

    // No direction, reason, blocker UID or availability in the response.
    return { reconciled: true };
  }
);

/** Internal transaction also exercised by isolated Firestore Emulator tests. */
export async function reconcilePublicMediaAccessPair(
  viewerUid: string,
  ownerUid: string
): Promise<void> {
  const viewerRef = db.doc(`users/${viewerUid}`);
  const ownerRef = db.doc(`users/${ownerUid}`);
  const outgoingRef = viewerRef.collection('blocks').doc(ownerUid);
  const incomingRef = ownerRef.collection('blocks').doc(viewerUid);
  const viewerProjectionRef = db.doc(
    `public_media_access/${viewerUid}/owners/${ownerUid}`
  );
  await db.runTransaction(async (tx) => {
    const [
      viewer, owner, outgoing, incoming, viewerProjection,
    ] = await Promise.all([
      tx.get(viewerRef),
      tx.get(ownerRef),
      tx.get(outgoingRef),
      tx.get(incomingRef),
      tx.get(viewerProjectionRef),
    ]);

    // Reconciliation is not a second age policy; this is account authority.
    assertPlatformAccountAccessData(viewer.data());
    // Lock the canonical owner state into this transaction. A concurrent
    // lifecycle transition forces a retry, preventing stale re-materialization.
    const ownerState = owner.data();
    if (!owner.exists || ownerState?.['accountStatus'] !== 'active' ||
        ownerState?.['loginAllowed'] === false ||
        ownerState?.['accountLocked'] === true) {
      // Legacy cache may survive until cleanup; never grant via its existence.
      if (viewerProjection.exists) tx.delete(viewerProjectionRef);
      return;
    }

    const available = isBilateralPublicMediaAvailable(
      outgoing.data()?.isBlocked, incoming.data()?.isBlocked
    );
    if (
      viewerProjection.data()?.version === 1 &&
      viewerProjection.data()?.available === available
    ) {
      return;
    }

    const projection = {
      available,
      ownerUid,
      version: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Never write the reverse document here: passively watching a video
    // must not leave a discoverable record in the owner's own scope.
    tx.set(viewerProjectionRef, projection);
  });
}
