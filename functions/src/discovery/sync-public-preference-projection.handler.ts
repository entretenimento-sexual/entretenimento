// functions/src/discovery/sync-public-preference-projection.handler.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';

export const syncPublicPreferenceProjection = onDocumentWritten(
  'users/{userId}/preferences/profile',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();
    if (!uid) return;

    const publicRef = db.collection('public_profiles').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const [publicSnapshot, userSnapshot] = await Promise.all([
      publicRef.get(),
      userRef.get(),
    ]);

    if (!publicSnapshot.exists) return;

    const profile = event.data?.after.exists ? (event.data.after.data() ?? {}) : null;
    const user = userSnapshot.exists ? (userSnapshot.data() ?? {}) : {};
    const expected = buildPublicPreferenceProjection(profile, {
      canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic'),
    });
    const current = publicSnapshot.data() ?? {};

    if (publicPreferenceProjectionMatches(current, expected)) return;

    await publicRef.set(
      {
        ...expected,
        publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log('[discovery] Preferências públicas sincronizadas.', {
      uid,
      visible: expected.preferenceBadgesVisible,
      relationshipIntentCount: expected.publicRelationshipIntents.length,
      sexualPracticeCount: expected.publicSexualPractices.length,
      bodyTraitCount: expected.publicBodyTraits.length,
    });
  }
);
