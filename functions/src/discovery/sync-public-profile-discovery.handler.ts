// functions/src/discovery/sync-public-profile-discovery.handler.ts
// -----------------------------------------------------------------------------
// SYNC PUBLIC PROFILE DISCOVERY
// -----------------------------------------------------------------------------
// Copia para public_profiles apenas campos canônicos de discovery calculados no
// backend a partir de users/{uid} e da autorização de preferências do proprietário.
//
// Escritas de billing/lifecycle que não alteram compatibilidade ou projeções
// públicas não renovam updatedAt e, portanto, não interferem artificialmente na
// ordenação da vitrine.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';
import {
  publicProfileDiscoveryProjectionMatches,
} from './public-profile-discovery-projection';

export const syncPublicProfileDiscovery = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();
    const after = event.data?.after;

    if (!uid || !after?.exists) return;

    const publicProfileRef = db.collection('public_profiles').doc(uid);
    const preferenceRef = db
      .collection('users')
      .doc(uid)
      .collection('preferences')
      .doc('profile');
    const [publicProfileSnapshot, preferenceSnapshot] = await Promise.all([
      publicProfileRef.get(),
      preferenceRef.get(),
    ]);

    if (!publicProfileSnapshot.exists) {
      console.log('[discovery] Sync canônico ignorado: public_profile ausente.', {
        uid,
      });
      return;
    }

    const user = after.data() ?? {};
    const canonical = normalizeProfileDiscoveryFields(user);
    const age = normalizePublicAge(user['idade'] ?? user['age']);
    const publicPreferences = buildPublicPreferenceProjection(
      preferenceSnapshot.exists ? (preferenceSnapshot.data() ?? {}) : null,
      {
        canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic'),
        bodyTraits: user['bodyTraits'],
      }
    );
    const currentPublic = publicProfileSnapshot.data() ?? {};

    if (
      publicProfileDiscoveryProjectionMatches(currentPublic, canonical) &&
      (currentPublic['age'] ?? null) === age &&
      publicPreferenceProjectionMatches(currentPublic, publicPreferences)
    ) {
      return;
    }

    await publicProfileRef.set(
      {
        normalizedGender: canonical.normalizedGender,
        normalizedOrientation: canonical.normalizedOrientation,
        interestedInGenders: canonical.interestedInGenders,
        interestedInOrientations: canonical.interestedInOrientations,
        compatibilityReady: canonical.compatibilityReady,
        age,
        ...publicPreferences,
        discoveryNormalizedAt: FieldValue.serverTimestamp(),
        publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log('[discovery] Campos canônicos sincronizados.', {
      uid,
      normalizedGender: canonical.normalizedGender,
      normalizedOrientation: canonical.normalizedOrientation,
      compatibilityReady: canonical.compatibilityReady,
      hasPublicAge: age !== null,
      preferenceBadgesVisible: publicPreferences.preferenceBadgesVisible,
      publicBodyTraitCount: publicPreferences.publicBodyTraits.length,
    });
  }
);

function normalizePublicAge(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const age = Math.round(value);
  return age >= 18 && age <= 100 ? age : null;
}
