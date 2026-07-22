// functions/src/discovery/sync-public-profile-discovery.handler.ts
// -----------------------------------------------------------------------------
// SYNC PUBLIC PROFILE DISCOVERY
// -----------------------------------------------------------------------------
// Copia para public_profiles apenas campos canônicos de discovery calculados no
// backend a partir de users/{uid}.
//
// Escritas de billing/lifecycle que não alteram compatibilidade não renovam
// updatedAt e, portanto, não interferem artificialmente na ordenação da vitrine.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';
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
    const publicProfileSnapshot = await publicProfileRef.get();

    if (!publicProfileSnapshot.exists) {
      console.log('[discovery] Sync canônico ignorado: public_profile ausente.', {
        uid,
      });
      return;
    }

    const user = after.data() ?? {};
    const canonical = normalizeProfileDiscoveryFields(user);
    const currentPublic = publicProfileSnapshot.data() ?? {};

    if (publicProfileDiscoveryProjectionMatches(currentPublic, canonical)) {
      return;
    }

    await publicProfileRef.set(
      {
        normalizedGender: canonical.normalizedGender,
        normalizedOrientation: canonical.normalizedOrientation,
        interestedInGenders: canonical.interestedInGenders,
        interestedInOrientations: canonical.interestedInOrientations,
        compatibilityReady: canonical.compatibilityReady,
        discoveryNormalizedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log('[discovery] Campos canônicos sincronizados.', {
      uid,
      normalizedGender: canonical.normalizedGender,
      normalizedOrientation: canonical.normalizedOrientation,
      compatibilityReady: canonical.compatibilityReady,
    });
  }
);
