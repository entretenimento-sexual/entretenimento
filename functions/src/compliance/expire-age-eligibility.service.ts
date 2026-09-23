// functions/src/compliance/expire-age-eligibility.service.ts
// -----------------------------------------------------------------------------
// CANONICAL AGE ELIGIBILITY EXPIRATION MATERIALIZER
// -----------------------------------------------------------------------------
// Materializa VERIFIED_ADULT -> EXPIRED de forma transacional. Pode ser chamado
// tanto pela Cloud Task pontual quanto pelo sweep de recuperação.
//
// Uma tarefa carrega a geração (updatedAtMs) e o expiresAt esperados. Se houver
// reverificação posterior, o registro deixa de coincidir e a tarefa antiga vira
// no-op, sem derrubar a nova decisão.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../firebaseApp';
import {
  writeAgeEligibilityExpiredNotificationInTransaction,
} from '../moderation/moderation-safety-notification.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';

export type AgeEligibilityExpirationResultReason =
  | 'expired'
  | 'missing'
  | 'not-due'
  | 'stale';

export interface AgeEligibilityExpirationResult {
  readonly expired: boolean;
  readonly reason: AgeEligibilityExpirationResultReason;
}

export interface MaterializeAgeEligibilityExpirationOptions {
  readonly expectedExpiresAtMs?: number;
  readonly expectedUpdatedAtMs?: number;
}

function cleanUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function positiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMillis(value: unknown): number | null {
  const direct = positiveTime(value);
  if (direct !== null) return direct;

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const parsed = (value as { toMillis: () => number }).toMillis();
    return positiveTime(parsed);
  }

  return null;
}

export async function materializeExpiredAgeEligibility(
  uidValue: unknown,
  nowValue: number,
  options: MaterializeAgeEligibilityExpirationOptions = {}
): Promise<AgeEligibilityExpirationResult> {
  const uid = cleanUid(uidValue);
  const nowMs = positiveTime(nowValue) ?? Date.now();

  if (!uid) {
    return { expired: false, reason: 'missing' };
  }

  const recordRef = db.collection('age_eligibility_records').doc(uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const [recordSnapshot, userSnapshot] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(userRef),
    ]);

    if (!recordSnapshot.exists) {
      return { expired: false, reason: 'missing' };
    }

    const rawRecord = recordSnapshot.data() ?? {};
    const rawStatus = String(rawRecord['status'] ?? '')
      .trim()
      .toUpperCase();
    const rawExpiresAtMs =
      toMillis(rawRecord['expiresAtMs']) ?? toMillis(rawRecord['expiresAt']);
    const rawUpdatedAtMs =
      toMillis(rawRecord['updatedAtMs']) ?? toMillis(rawRecord['updatedAt']);

    if (
      rawStatus !== 'VERIFIED_ADULT' ||
      (
        options.expectedExpiresAtMs !== undefined &&
        rawExpiresAtMs !== options.expectedExpiresAtMs
      ) ||
      (
        options.expectedUpdatedAtMs !== undefined &&
        rawUpdatedAtMs !== options.expectedUpdatedAtMs
      )
    ) {
      return { expired: false, reason: 'stale' };
    }

    const decision = evaluateCanonicalAgeEligibility({
      uid,
      rawRecord,
      nowMs,
    });

    if (
      decision.denialReason !== 'verification_expired' ||
      decision.expiresAtMs === null
    ) {
      return { expired: false, reason: 'not-due' };
    }

    if (decision.source === null || decision.method === null) {
      return { expired: false, reason: 'stale' };
    }

    const ageEligibility = writeCanonicalAgeEligibilityInTransaction(
      transaction,
      {
        uid,
        status: 'EXPIRED',
        source: decision.source,
        method: decision.method,
        caseId: decision.caseId,
        verifiedAtMs: decision.verifiedAtMs,
        decidedAtMs: nowMs,
        expiresAtMs: decision.expiresAtMs,
      }
    );

    if (userSnapshot.exists) {
      transaction.set(
        userRef,
        {
          ageEligibility,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      writeAgeEligibilityExpiredNotificationInTransaction(
        transaction,
        {
          uid,
          expiresAtMs: decision.expiresAtMs,
        }
      );
    }

    transaction.set(
      db
        .collection('compliance_audit')
        .doc(`age_expired_${uid}_${decision.expiresAtMs}`),
      {
        uid,
        type: 'age_eligibility.expired',
        previousStatus: 'VERIFIED_ADULT',
        nextStatus: 'EXPIRED',
        source: decision.source,
        method: decision.method,
        caseId: decision.caseId,
        verifiedAtMs: decision.verifiedAtMs,
        expiresAtMs: decision.expiresAtMs,
        materializedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );

    return { expired: true, reason: 'expired' };
  });
}
