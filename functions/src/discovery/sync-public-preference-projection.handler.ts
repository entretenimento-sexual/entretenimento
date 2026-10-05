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
    const intentStatusRef = db
      .collection('user_intent_statuses')
      .doc(`current_${uid}`);

    await db.runTransaction(async (transaction) => {
      const [
        publicSnapshot,
        userSnapshot,
        preferenceSnapshot,
        intentStatusSnapshot,
      ] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(userRef),
        transaction.get(preferenceRef),
        transaction.get(intentStatusRef),
      ]);

      if (!userSnapshot.exists) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      const user = userSnapshot.data() ?? {};
      const profile = preferenceSnapshot.exists
        ? (preferenceSnapshot.data() ?? {})
        : null;
      const profileVisibility =
        profile &&
        typeof profile === 'object' &&
        !Array.isArray(profile) &&
        (profile as Record<string, unknown>)['visibility'] &&
        typeof (profile as Record<string, unknown>)['visibility'] === 'object'
          ? (profile as Record<string, unknown>)['visibility'] as Record<string, unknown>
          : {};
      const showIntentPublicly =
        profileVisibility['showIntentPublicly'] === true;

      if (intentStatusSnapshot.exists && !showIntentPublicly) {
        const status = intentStatusSnapshot.data() ?? {};
        const moderation =
          status['moderation'] &&
          typeof status['moderation'] === 'object' &&
          !Array.isArray(status['moderation'])
            ? status['moderation'] as Record<string, unknown>
            : {};

        if (
          status['visibility'] === 'public_discovery' &&
          moderation['state'] === 'active'
        ) {
          transaction.set(
            intentStatusRef,
            {
              moderation: {
                state: 'hidden',
                reviewedAt: null,
                reviewedBy: null,
                reason: 'public_intent_visibility_disabled',
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }


      if (isPublicProfileProjectionBlocked(user)) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      if (!publicSnapshot.exists) {
        return;
      }

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
          ageEligibilityAdultAccessAllowed: FieldValue.delete(),
          ageEligibilityVerifiedAdult: FieldValue.delete(),
          ageEligibilityAssurance: FieldValue.delete(),
          ageEligibilityValidUntil: FieldValue.delete(),
          publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    console.log('[discovery] Preferências públicas sincronizadas.', { uid });
  }
);
