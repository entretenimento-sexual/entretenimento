// functions/src/discovery/sync-public-preference-projection.handler.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';
import { isPublicProfileProjectionBlocked } from './public-profile-projection-access';

export const syncPublicPreferenceProjection = onDocumentWritten(
  'users/{userId}/preferences/profile',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();

    if (!uid) {
      return;
    }

    const publicRef = db.collection('public_profiles').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const preferenceRef = userRef.collection('preferences').doc('profile');

    await db.runTransaction(async (transaction) => {
      const [publicSnapshot, userSnapshot, preferenceSnapshot] =
        await Promise.all([
          transaction.get(publicRef),
          transaction.get(userRef),
          transaction.get(preferenceRef),
        ]);

      if (!userSnapshot.exists) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      const user = userSnapshot.data() ?? {};

      if (isPublicProfileProjectionBlocked(user)) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      if (!publicSnapshot.exists) {
        return;
      }

      const profile = preferenceSnapshot.exists
        ? (preferenceSnapshot.data() ?? {})
        : null;
      const expected = buildPublicPreferenceProjection(profile, {
        canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic'),
      });
      const current = publicSnapshot.data() ?? {};

      if (publicPreferenceProjectionMatches(current, expected)) {
        return;
      }

      transaction.set(
        publicRef,
        {
          ...expected,
          publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    console.log('[discovery] Preferências públicas sincronizadas.', { uid });
  }
);
