// functions/src/discovery/public-age-eligibility-projection.handler.ts
// -----------------------------------------------------------------------------
// PUBLIC AGE ELIGIBILITY PROJECTION
// -----------------------------------------------------------------------------
// Materializa apenas o booleano sanitizado que informa se a autoridade etária
// permite exposição adulta neste momento. Idade exata nunca é projetada.
//
// O campo permite filtrar discovery/mídia/status sem uma leitura da autoridade
// canônica por item e preserva public_profiles para restauração após reverificar.
// -----------------------------------------------------------------------------

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  onDocumentCreated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';

import {
  evaluateCanonicalAgeEligibility,
} from '../compliance/age-eligibility.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';

export const PUBLIC_AGE_ACCESS_ALLOWED_FIELD =
  'ageEligibilityAdultAccessAllowed' as const;
export const PUBLIC_AGE_VERIFIED_ADULT_FIELD =
  'ageEligibilityVerifiedAdult' as const;
export const PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD =
  'ageEligibilityValidUntil' as const;

const PUBLIC_AGE_ELIGIBILITY_MAX_VALID_UNTIL_MS = 253402300799999;
const WRITE_BATCH_SIZE = 400;

function timestampToMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }

  return null;
}

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function statusCanRemainPublic(
  status: Record<string, unknown>,
  nowMs: number
): boolean {
  const moderation = status['moderation'] as
    | { state?: unknown }
    | null
    | undefined;
  const visibility = String(status['visibility'] ?? '').trim();
  const expiresAt = Number(status['expiresAt'] ?? 0);

  return moderation?.state === 'active' &&
    visibility === 'public_discovery' &&
    Number.isFinite(expiresAt) &&
    expiresAt > nowMs;
}

async function setDocumentsEligibility(
  documents: readonly QueryDocumentSnapshot[],
  accessAllowed: boolean,
  verifiedAdult: boolean,
  validUntilMs: number
): Promise<number> {
  let updated = 0;

  for (let index = 0; index < documents.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    let batchWrites = 0;

    for (const document of documents.slice(index, index + WRITE_BATCH_SIZE)) {
      const data = document.data() ?? {};
      const currentAccessAllowed =
        data[PUBLIC_AGE_ACCESS_ALLOWED_FIELD] === true;
      const currentVerifiedAdult =
        data[PUBLIC_AGE_VERIFIED_ADULT_FIELD] === true;
      const currentValidUntilMs = timestampToMillis(
        data[PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]
      );

      if (
        currentAccessAllowed === accessAllowed &&
        currentVerifiedAdult === verifiedAdult &&
        currentValidUntilMs === validUntilMs
      ) {
        continue;
      }

      batch.set(
        document.ref,
        {
          [PUBLIC_AGE_ACCESS_ALLOWED_FIELD]: accessAllowed,
          [PUBLIC_AGE_VERIFIED_ADULT_FIELD]: verifiedAdult,
          [PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]:
            Timestamp.fromMillis(validUntilMs),
        },
        { merge: true }
      );
      batchWrites += 1;
      updated += 1;
    }

    if (batchWrites > 0) {
      await batch.commit();
    }
  }

  return updated;
}

export async function reconcilePublicAgeEligibilityProjection(
  uidValue: unknown,
  options: { forceChildren?: boolean; nowMs?: number } = {}
): Promise<{
  eligible: boolean;
  profileUpdated: boolean;
  mediaUpdated: number;
  statusUpdated: boolean;
}> {
  const uid = cleanUid(uidValue);

  if (!uid) {
    return {
      eligible: false,
      profileUpdated: false,
      mediaUpdated: 0,
      statusUpdated: false,
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const ageRef = db.collection('age_eligibility_records').doc(uid);
  const profileRef = db.collection('public_profiles').doc(uid);
  const statusRef = db
    .collection('user_intent_statuses')
    .doc(`current_${uid}`);

  const [ageSnapshot, profileSnapshot] = await Promise.all([
    ageRef.get(),
    profileRef.get(),
  ]);
  const decision = evaluateCanonicalAgeEligibility({
    uid,
    rawRecord: ageSnapshot.exists ? ageSnapshot.data() : null,
    nowMs,
  });
  const accessAllowed = decision.allowed && profileSnapshot.exists;
  const verifiedAdult =
    decision.allowed &&
    decision.status === 'VERIFIED_ADULT' &&
    profileSnapshot.exists;
  const validUntilMs = decision.allowed
    ? decision.expiresAtMs ?? PUBLIC_AGE_ELIGIBILITY_MAX_VALID_UNTIL_MS
    : 0;
  const currentProfileAccessAllowed = profileSnapshot.exists
    ? profileSnapshot.data()?.[PUBLIC_AGE_ACCESS_ALLOWED_FIELD] === true
    : false;
  const currentProfileVerifiedAdult = profileSnapshot.exists
    ? profileSnapshot.data()?.[PUBLIC_AGE_VERIFIED_ADULT_FIELD] === true
    : false;
  const currentProfileValidUntilMs = profileSnapshot.exists
    ? timestampToMillis(
      profileSnapshot.data()?.[PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]
    )
    : null;
  let profileUpdated = false;
  let mediaUpdated = 0;
  let statusUpdated = false;

  if (
    profileSnapshot.exists &&
    (currentProfileAccessAllowed !== accessAllowed ||
      currentProfileVerifiedAdult !== verifiedAdult ||
      currentProfileValidUntilMs !== validUntilMs)
  ) {
    await profileRef.set(
      {
        [PUBLIC_AGE_ACCESS_ALLOWED_FIELD]: accessAllowed,
        [PUBLIC_AGE_VERIFIED_ADULT_FIELD]: verifiedAdult,
        [PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]:
          Timestamp.fromMillis(validUntilMs),
      },
      { merge: true }
    );
    profileUpdated = true;
  }

  const shouldSyncChildren =
    options.forceChildren === true ||
    currentProfileAccessAllowed !== accessAllowed ||
    currentProfileVerifiedAdult !== verifiedAdult ||
    currentProfileValidUntilMs !== validUntilMs;

  if (shouldSyncChildren) {
    const [photosSnapshot, videosSnapshot, statusSnapshot] =
      await Promise.all([
        profileRef.collection('public_photos').get(),
        profileRef.collection('public_videos').get(),
        statusRef.get(),
      ]);

    mediaUpdated += await setDocumentsEligibility(
      [...photosSnapshot.docs, ...videosSnapshot.docs],
      accessAllowed,
      verifiedAdult,
      validUntilMs
    );

    if (statusSnapshot.exists) {
      const status = (statusSnapshot.data() ?? {}) as Record<string, unknown>;
      const statusAccessAllowed =
        accessAllowed && statusCanRemainPublic(status, nowMs);
      const statusVerifiedAdult =
        verifiedAdult && statusCanRemainPublic(status, nowMs);

      const statusValidUntilMs = statusAccessAllowed ? validUntilMs : 0;
      const currentStatusValidUntilMs = timestampToMillis(
        status[PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]
      );

      if (
        status[PUBLIC_AGE_ACCESS_ALLOWED_FIELD] !== statusAccessAllowed ||
        status[PUBLIC_AGE_VERIFIED_ADULT_FIELD] !== statusVerifiedAdult ||
        currentStatusValidUntilMs !== statusValidUntilMs
      ) {
        await statusRef.set(
          {
            [PUBLIC_AGE_ACCESS_ALLOWED_FIELD]: statusAccessAllowed,
            [PUBLIC_AGE_VERIFIED_ADULT_FIELD]: statusVerifiedAdult,
            [PUBLIC_AGE_ELIGIBILITY_VALID_UNTIL_FIELD]:
              Timestamp.fromMillis(statusValidUntilMs),
          },
          { merge: true }
        );
        statusUpdated = true;
      }
    }
  }

  return {
    eligible: accessAllowed,
    profileUpdated,
    mediaUpdated,
    statusUpdated,
  };
}

export const syncPublicAgeEligibilityProjection = onDocumentWritten(
  {
    document: 'age_eligibility_records/{userId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const result = await reconcilePublicAgeEligibilityProjection(
      event.params.userId,
      { forceChildren: true }
    );

    console.log('[ageEligibility] Projeção pública reconciliada.', {
      uid: event.params.userId,
      ...result,
    });
  }
);

export const initializePublicAgeEligibilityProjection = onDocumentCreated(
  {
    document: 'public_profiles/{userId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const result = await reconcilePublicAgeEligibilityProjection(
      event.params.userId,
      { forceChildren: true }
    );

    console.log('[ageEligibility] Projeção pública inicializada.', {
      uid: event.params.userId,
      ...result,
    });
  }
);
