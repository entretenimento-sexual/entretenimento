// functions/src/discovery/sync-public-profile-discovery.handler.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';
import { publicProfileDiscoveryProjectionMatches } from './public-profile-discovery-projection';

export const syncPublicProfileDiscovery = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();
    const after = event.data?.after;
    if (!uid || !after?.exists) return;

    const publicProfileRef = db.collection('public_profiles').doc(uid);
    const preferenceRef = db.collection('users').doc(uid).collection('preferences').doc('profile');
    const [publicProfileSnapshot, preferenceSnapshot] = await Promise.all([
      publicProfileRef.get(),
      preferenceRef.get(),
    ]);
    if (!publicProfileSnapshot.exists) return;

    const user = after.data() ?? {};
    const canonical = normalizeProfileDiscoveryFields(user);
    const age = normalizePublicAge(user['idade'] ?? user['age']);
    const descricao = normalizePublicDescription(
      user['descricao'] ?? user['description'] ?? user['bio']
    );
    const publicPreferences = buildPublicPreferenceProjection(
      preferenceSnapshot.exists ? (preferenceSnapshot.data() ?? {}) : null,
      { canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic') }
    );
    const currentPublic = publicProfileSnapshot.data() ?? {};

    if (
      publicProfileDiscoveryProjectionMatches(currentPublic, canonical) &&
      (currentPublic['age'] ?? null) === age &&
      (currentPublic['descricao'] ?? null) === descricao &&
      publicPreferenceProjectionMatches(currentPublic, publicPreferences)
    ) return;

    await publicProfileRef.set(
      {
        normalizedGender: canonical.normalizedGender,
        normalizedOrientation: canonical.normalizedOrientation,
        interestedInGenders: canonical.interestedInGenders,
        interestedInOrientations: canonical.interestedInOrientations,
        compatibilityReady: canonical.compatibilityReady,
        age,
        descricao,
        ...publicPreferences,
        discoveryNormalizedAt: FieldValue.serverTimestamp(),
        publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

function normalizePublicAge(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const age = Math.round(value);
  return age >= 18 && age <= 100 ? age : null;
}

function normalizePublicDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);

  return normalized || null;
}
