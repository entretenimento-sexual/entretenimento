// functions/src/discovery/sync-public-profile-discovery.handler.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../firebaseApp';
import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  resolveProfileIdentityOption,
} from '../identity/profile-identity.catalog';
import {
  normalizePublicProfileId,
  resolveOrGeneratePublicProfileId,
} from '../identity/public-profile-id';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';
import { isPublicProfileProjectionBlocked } from './public-profile-projection-access';
import {
  buildPublicAvatarProjection,
  buildPublicLocationProjection,
  publicAvatarProjectionMatches,
  publicLocationProjectionMatches,
  publicProfileDiscoveryProjectionMatches,
} from './public-profile-discovery-projection';

interface PublicIdentityProjection {
  identityCode: string | null;
  identityCatalogVersion: number | null;
  identityLabel: string | null;
  identityShortLabel: string | null;
  identityDiscoveryGroup: string | null;
}

export const syncPublicProfileDiscovery = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();

    if (!uid) {
      return;
    }

    const userRef = db.collection('users').doc(uid);
    const publicProfileRef = db.collection('public_profiles').doc(uid);
    const preferenceRef = userRef.collection('preferences').doc('profile');

    await db.runTransaction(async (transaction) => {
      const [userSnapshot, publicProfileSnapshot, preferenceSnapshot] =
        await Promise.all([
          transaction.get(userRef),
          transaction.get(publicProfileRef),
          transaction.get(preferenceRef),
        ]);

      if (!userSnapshot.exists) {
        if (publicProfileSnapshot.exists) {
          transaction.delete(publicProfileRef);
        }
        return;
      }

      const user = userSnapshot.data() ?? {};
      const storedProfileId = normalizePublicProfileId(user['profileId']);
      const profileId = storedProfileId
        ?? resolveOrGeneratePublicProfileId(null);

      if (!storedProfileId) {
        transaction.set(
          userRef,
          { profileId },
          { merge: true }
        );
      }

      if (isPublicProfileProjectionBlocked(user)) {
        if (publicProfileSnapshot.exists) {
          transaction.delete(publicProfileRef);
        }
        return;
      }

      if (!publicProfileSnapshot.exists) {
        return;
      }

      const publicIdentity = buildPublicIdentityProjection(user);
      const discoverySource = publicIdentity.identityDiscoveryGroup
        ? {
          ...user,
          // O catálogo é a fonte canônica para códigos declarados. A camada
          // antiga de normalização continua existindo apenas como fallback
          // para dados legados e texto livre de preferências.
          gender: publicIdentity.identityDiscoveryGroup,
          genero: publicIdentity.identityDiscoveryGroup,
        }
        : user;
      const canonical = normalizeProfileDiscoveryFields(discoverySource);
      const age = normalizePublicAge(user['idade'] ?? user['age']);
      const publicPreferences = buildPublicPreferenceProjection(
        preferenceSnapshot.exists ? (preferenceSnapshot.data() ?? {}) : null,
        { canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic') }
      );
      const publicLocation = buildPublicLocationProjection(user);
      const publicAvatar = buildPublicAvatarProjection(user);
      const currentPublic = publicProfileSnapshot.data() ?? {};

      if (
        currentPublic['profileId'] === profileId &&
        publicProfileDiscoveryProjectionMatches(currentPublic, canonical) &&
        publicIdentityProjectionMatches(currentPublic, publicIdentity) &&
        (currentPublic['age'] ?? null) === age &&
        publicPreferenceProjectionMatches(currentPublic, publicPreferences) &&
        publicLocationProjectionMatches(currentPublic, publicLocation) &&
        publicAvatarProjectionMatches(currentPublic, publicAvatar)
      ) {
        return;
      }

      transaction.set(
        publicProfileRef,
        {
          profileId,
          gender: publicIdentity.identityCode ?? currentPublic['gender'] ?? null,
          ...publicIdentity,
          ...publicAvatar,
          normalizedGender: canonical.normalizedGender,
          normalizedOrientation: canonical.normalizedOrientation,
          interestedInGenders: canonical.interestedInGenders,
          interestedInOrientations: canonical.interestedInOrientations,
          compatibilityReady: canonical.compatibilityReady,
          age,
          ...publicPreferences,
          ...publicLocation,
          discoveryNormalizedAt: FieldValue.serverTimestamp(),
          publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }
);

function buildPublicIdentityProjection(
  user: Record<string, unknown>
): PublicIdentityProjection {
  const identityCode = String(
    user['declaredIdentityCode'] ?? user['gender'] ?? ''
  ).trim().toLowerCase() || null;
  const option = resolveProfileIdentityOption(identityCode);
  const storedVersion = Number(user['identityCatalogVersion']);
  const identityCatalogVersion = Number.isInteger(storedVersion) && storedVersion >= 1
    ? storedVersion
    : option
      ? PROFILE_IDENTITY_CATALOG_VERSION
      : null;

  return {
    identityCode,
    identityCatalogVersion,
    identityLabel: option?.label ?? null,
    identityShortLabel: option?.shortLabel ?? null,
    identityDiscoveryGroup: option?.discoveryGroup ?? null,
  };
}

function publicIdentityProjectionMatches(
  current: Record<string, unknown>,
  expected: PublicIdentityProjection
): boolean {
  return (
    (current['identityCode'] ?? null) === expected.identityCode
    && (current['identityCatalogVersion'] ?? null) === expected.identityCatalogVersion
    && (current['identityLabel'] ?? null) === expected.identityLabel
    && (current['identityShortLabel'] ?? null) === expected.identityShortLabel
    && (current['identityDiscoveryGroup'] ?? null) === expected.identityDiscoveryGroup
    && (current['gender'] ?? null) === expected.identityCode
  );
}

function normalizePublicAge(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const age = Math.round(value);
  return age >= 18 && age <= 100 ? age : null;
}
