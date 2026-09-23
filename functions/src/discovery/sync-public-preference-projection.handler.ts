// functions/src/discovery/sync-public-preference-projection.handler.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  evaluateCanonicalAgeEligibility,
} from '../compliance/age-eligibility.policy';
import { db, FieldValue, Timestamp } from '../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';

const PUBLIC_AGE_ELIGIBILITY_MAX_VALID_UNTIL_MS = 253402300799999;

function publicAgeValidUntilMs(data: Record<string, unknown>): number | null {
  const value = data['ageEligibilityValidUntil'] as
    | { toMillis?: unknown }
    | null
    | undefined;
  return value && typeof value.toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : null;
}
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
    const ageEligibilityRef = db
      .collection('age_eligibility_records')
      .doc(uid);

    await db.runTransaction(async (transaction) => {
      const [
        publicSnapshot,
        userSnapshot,
        preferenceSnapshot,
        ageEligibilitySnapshot,
      ] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(userRef),
        transaction.get(preferenceRef),
        transaction.get(ageEligibilityRef),
      ]);

      if (!userSnapshot.exists) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      const user = userSnapshot.data() ?? {};

      const ageDecision = evaluateCanonicalAgeEligibility({
        uid,
        rawRecord: ageEligibilitySnapshot.exists
          ? ageEligibilitySnapshot.data()
          : null,
      });

      if (isPublicProfileProjectionBlocked(user)) {
        if (publicSnapshot.exists) {
          transaction.delete(publicRef);
        }
        return;
      }

      if (!ageDecision.allowed) {
        const current = publicSnapshot.data() ?? {};
        if (
          publicSnapshot.exists &&
          (
            current['ageEligibilityAdultAccessAllowed'] !== false ||
            publicAgeValidUntilMs(current) !== 0
          )
        ) {
          transaction.set(
            publicRef,
            {
              ageEligibilityAdultAccessAllowed: false,
              ageEligibilityVerifiedAdult: false,
              ageEligibilityValidUntil: Timestamp.fromMillis(0),
            },
            { merge: true }
          );
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
      const ageEligibilityValidUntilMs =
        ageDecision.expiresAtMs ?? PUBLIC_AGE_ELIGIBILITY_MAX_VALID_UNTIL_MS;
      const ageEligibilityValidUntil =
        Timestamp.fromMillis(ageEligibilityValidUntilMs);
      const ageEligibilityVerifiedAdult =
        ageDecision.status === 'VERIFIED_ADULT';

      if (
        current['ageEligibilityAdultAccessAllowed'] === true &&
        current['ageEligibilityVerifiedAdult'] === ageEligibilityVerifiedAdult &&
        publicAgeValidUntilMs(current) === ageEligibilityValidUntilMs &&
        publicPreferenceProjectionMatches(current, expected)
      ) {
        return;
      }

      transaction.set(
        publicRef,
        {
          ageEligibilityAdultAccessAllowed: true,
          ageEligibilityVerifiedAdult,
          ageEligibilityValidUntil,
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
