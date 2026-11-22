import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { warn } from 'firebase-functions/logger';

import { isUserEligibleForPublicProjection } from '../account_lifecycle/_shared';
import { db } from '../firebaseApp';
import { canPublishNicknameIndex } from '../registration/registration-nickname-availability.policy';
import {
  deleteOwnedNicknameIndex, NICKNAME_INDEX_COLLECTION, nicknameIndexRef,
  readNicknameIndex, writeNicknameIndex,
} from './nickname-index.service';
import {
  isNicknameIndexKey, isNicknamePublicProjectionAligned, resolveNicknameNormalized,
} from './nickname-key.policy';

export async function reconcileNicknameIndex(
  firestore: FirebaseFirestore.Firestore, uid: string,
): Promise<void> {
  await firestore.runTransaction(async tx => {
    const [privateProfile, publicProfile] = await tx.getAll(
      firestore.collection('users').doc(uid),
      firestore.collection('public_profiles').doc(uid),
    );
    const user = privateProfile.data();
    const projection = publicProfile.data();
    const key = user ? resolveNicknameNormalized(user) : '';
    const eligible = !!user && user.uid === uid &&
      isUserEligibleForPublicProjection(user) && !!projection &&
      (projection.publicVisibility == null || projection.publicVisibility === 'visible');
    if (eligible && !isNicknamePublicProjectionAligned(uid, user, projection)) {
      warn('Indexação de apelido ignorada por divergência entre conta e projeção.');
      return;
    }

    const index = eligible ? await readNicknameIndex(firestore, tx, key) : null;
    const canPublish = eligible && await canPublishNicknameIndex(firestore, tx, index, uid, user);
    if (eligible && !canPublish) {
      warn('Indexação de apelido ignorada por conflito de titularidade.');
    }

    const existing = await tx.get(
      firestore.collection(NICKNAME_INDEX_COLLECTION).where('uid', '==', uid).select('uid'),
    );
    const holdsReservation = !!user && user.uid === uid && user.profileCompleted === false;
    const keepPath = (eligible || holdsReservation) && isNicknameIndexKey(key)
      ? nicknameIndexRef(firestore, key).path : null;
    for (const entry of existing.docs) {
      if (entry.ref.path !== keepPath) deleteOwnedNicknameIndex(tx, entry, uid);
    }
    if (canPublish && index) writeNicknameIndex(tx, index, uid);
  });
}

// O evento dispara a conciliação, que decide pela conta e projeção vigentes
// na mesma transação. O nome exportado mantém o identificador da Function.
export const onUserCreateIndexNickname = onDocumentWritten(
  'public_profiles/{userId}',
  async event => {
    const uid = event.params.userId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const nicknameUnchanged = before && after &&
      before.uid === after.uid && before.nickname === after.nickname &&
      before.nicknameNormalized === after.nicknameNormalized && before.publicVisibility === after.publicVisibility;
    if (!uid || nicknameUnchanged) return;
    await reconcileNicknameIndex(db, uid);
  },
);
