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
      canPublishAdvanced: hasMinimumActivePlan(user, 'basic'),
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

type MinimumPlan = 'basic' | 'premium' | 'vip';

function hasMinimumActivePlan(
  user: Record<string, unknown>,
  minimum: MinimumPlan,
  now = Date.now()
): boolean {
  const role = String(user['tier'] ?? user['role'] ?? '')
    .trim()
    .toLowerCase();

  if (role === 'admin') return true;

  const rank: Readonly<Record<MinimumPlan, number>> = {
    basic: 1,
    premium: 2,
    vip: 3,
  };

  if (!(role in rank)) return false;
  if (user['billingProjectionVersion'] !== 1) return false;
  if (user['isSubscriber'] !== true) return false;
  if (user['subscriptionStatus'] !== 'active') return false;
  if (user['subscriptionScope'] !== 'platform_subscription') return false;

  const startsAt = toMillis(user['subscriptionStartedAt']);
  const endsAt = toMillis(user['subscriptionEndsAt']);

  return (
    startsAt !== null &&
    endsAt !== null &&
    startsAt < endsAt &&
    now >= startsAt &&
    now < endsAt &&
    rank[role as MinimumPlan] >= rank[minimum]
  );
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const timestamp = value as { toMillis?: () => number } | null | undefined;
  if (typeof timestamp?.toMillis !== 'function') return null;

  const millis = timestamp.toMillis();
  return Number.isFinite(millis) ? millis : null;
}
