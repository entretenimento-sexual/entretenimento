// functions/src/compliance/expire-age-eligibility.schedule.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY EXPIRATION MATERIALIZER
// -----------------------------------------------------------------------------
// O relógio não gera eventos no Firestore. Este job materializa a passagem
// VERIFIED_ADULT -> EXPIRED somente para registros cujo expiresAt venceu.
//
// Segurança/custo:
// - consulta indexada apenas a autoridade canônica;
// - lote limitado por execução;
// - cada candidato é relido em transação;
// - uma reverificação concorrente sempre vence;
// - nunca deriva maioridade de campos do usuário.
// -----------------------------------------------------------------------------

import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp } from '../firebaseApp';
import {
  safeNotifyAgeEligibilityExpired,
} from '../moderation/moderation-safety-notification.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';

const MAX_RECORDS_PER_RUN = 500;
const TRANSACTION_CONCURRENCY = 10;

interface ExpirationResult {
  readonly expired: boolean;
  readonly notify: boolean;
  readonly expiresAtMs: number | null;
}

async function materializeExpiredRecord(
  uid: string,
  nowMs: number
): Promise<ExpirationResult> {
  const recordRef = db.collection('age_eligibility_records').doc(uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const [recordSnapshot, userSnapshot] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(userRef),
    ]);

    if (!recordSnapshot.exists) {
      return { expired: false, notify: false, expiresAtMs: null };
    }

    const rawRecord = recordSnapshot.data() ?? {};
    const decision = evaluateCanonicalAgeEligibility({
      uid,
      rawRecord,
      nowMs,
    });

    if (
      String(rawRecord['status'] ?? '').trim().toUpperCase() !==
        'VERIFIED_ADULT' ||
      decision.denialReason !== 'verification_expired' ||
      decision.expiresAtMs === null ||
      decision.source === null ||
      decision.method === null
    ) {
      return {
        expired: false,
        notify: false,
        expiresAtMs: decision.expiresAtMs,
      };
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

    return {
      expired: true,
      notify: userSnapshot.exists,
      expiresAtMs: decision.expiresAtMs,
    };
  });
}

async function processChunk(
  uids: readonly string[],
  nowMs: number
): Promise<number> {
  const results = await Promise.all(
    uids.map(async (uid) => {
      const result = await materializeExpiredRecord(uid, nowMs);

      if (result.expired && result.notify && result.expiresAtMs !== null) {
        await safeNotifyAgeEligibilityExpired({
          uid,
          expiresAtMs: result.expiresAtMs,
        });
      }

      return result.expired ? 1 : 0;
    })
  );

  return results.reduce((sum, value) => sum + value, 0);
}

export const expireAgeEligibilityRecords = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 240,
  },
  async () => {
    const nowMs = Date.now();
    const snapshot = await db
      .collection('age_eligibility_records')
      .where('status', '==', 'VERIFIED_ADULT')
      .where('expiresAt', '<=', Timestamp.fromMillis(nowMs))
      .orderBy('expiresAt', 'asc')
      .limit(MAX_RECORDS_PER_RUN)
      .get();

    let expired = 0;
    const uids = snapshot.docs.map((document) => document.id);

    for (
      let index = 0;
      index < uids.length;
      index += TRANSACTION_CONCURRENCY
    ) {
      expired += await processChunk(
        uids.slice(index, index + TRANSACTION_CONCURRENCY),
        nowMs
      );
    }

    console.log('[ageEligibility] Expiração temporal materializada.', {
      candidates: uids.length,
      expired,
      capped: snapshot.size >= MAX_RECORDS_PER_RUN,
      nowMs,
    });
  }
);
