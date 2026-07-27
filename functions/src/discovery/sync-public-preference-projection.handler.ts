// functions/src/discovery/sync-public-preference-projection.handler.ts
// -----------------------------------------------------------------------------
// SYNC PUBLIC PREFERENCE PROJECTION
// -----------------------------------------------------------------------------
// Observa users/{uid}/preferences/profile e materializa em public_profiles apenas
// sinais autorizados pelo próprio usuário. O documento privado continua sendo a
// fonte de verdade; clientes não podem escrever os campos backend-managed.
// -----------------------------------------------------------------------------

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

    if (!publicSnapshot.exists) {
      console.log('[discovery] Preferências públicas ignoradas: perfil ausente.', {
        uid,
      });
      return;
    }

    const profile = event.data?.after.exists
      ? (event.data.after.data() ?? {})
      : null;
    const user = userSnapshot.exists ? (userSnapshot.data() ?? {}) : {};
    const expected = buildPublicPreferenceProjection(profile, {
      canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic'),
      bodyTraits: user['bodyTraits'],
    });
    const current = publicSnapshot.data() ?? {};

    if (publicPreferenceProjectionMatches(current, expected)) {
      return;
    }

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
