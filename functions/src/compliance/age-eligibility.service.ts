// functions/src/compliance/age-eligibility.service.ts
// -----------------------------------------------------------------------------
// CANONICAL AGE ELIGIBILITY STORAGE
// -----------------------------------------------------------------------------
// age_eligibility_records/{uid} é a fonte de verdade.
// users/{uid}.ageEligibility é somente projeção sanitizada para UX reativa.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue, Timestamp } from '../firebaseApp';
import {
  AGE_ELIGIBILITY_POLICY_VERSION,
  type AgeEligibilityMethod,
  type AgeEligibilitySource,
  type AgeEligibilityStatus,
  type CanonicalAgeEligibilityRecord,
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';

export interface WriteAgeEligibilityInput {
  uid: string;
  status: AgeEligibilityStatus;
  source: AgeEligibilitySource;
  method: AgeEligibilityMethod;
  caseId?: string | null;
  verifiedAtMs?: number | null;
  decidedAtMs: number;
  expiresAtMs?: number | null;
}

export interface AgeEligibilityProjection {
  status: AgeEligibilityStatus;
  policyVersion: number;
  source: AgeEligibilitySource;
  method: AgeEligibilityMethod;
  caseId: string | null;
  verifiedAtMs: number | null;
  expiresAtMs: number | null;
  updatedAtMs: number;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanOptionalId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return !normalized ? null : cleanId(normalized) || null;
}

function nullablePositiveTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function buildCanonicalAgeEligibility(
  input: WriteAgeEligibilityInput
): {
  record: CanonicalAgeEligibilityRecord;
  projection: AgeEligibilityProjection;
} {
  const uid = cleanId(input.uid);
  const caseId = cleanOptionalId(input.caseId);
  const decidedAtMs = nullablePositiveTime(input.decidedAtMs);
  const verifiedAtMs = nullablePositiveTime(input.verifiedAtMs);
  const expiresAtMs = nullablePositiveTime(input.expiresAtMs);

  if (!uid || decidedAtMs === null) {
    throw new HttpsError(
      'invalid-argument',
      'Estado canônico de maioridade inválido.'
    );
  }

  if (input.status === 'VERIFIED_ADULT' && verifiedAtMs === null) {
    throw new HttpsError(
      'invalid-argument',
      'Maioridade verificada exige instante de verificação.'
    );
  }

  const updatedAtMs = decidedAtMs;
  const record: CanonicalAgeEligibilityRecord = {
    uid,
    status: input.status,
    policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
    source: input.source,
    method: input.method,
    caseId,
    verifiedAtMs,
    decidedAtMs,
    expiresAtMs,
    updatedAtMs,
  };
  const projection: AgeEligibilityProjection = {
    status: record.status,
    policyVersion: record.policyVersion,
    source: record.source,
    method: record.method,
    caseId: record.caseId,
    verifiedAtMs: record.verifiedAtMs,
    expiresAtMs: record.expiresAtMs,
    updatedAtMs,
  };

  return { record, projection };
}

export function writeCanonicalAgeEligibilityInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: WriteAgeEligibilityInput
): AgeEligibilityProjection {
  const state = buildCanonicalAgeEligibility(input);
  const recordRef = db
    .collection('age_eligibility_records')
    .doc(state.record.uid);

  transaction.set(
    recordRef,
    {
      ...state.record,
      verifiedAt: state.record.verifiedAtMs === null
        ? null
        : Timestamp.fromMillis(state.record.verifiedAtMs),
      decidedAt: Timestamp.fromMillis(state.record.decidedAtMs),
      expiresAt: state.record.expiresAtMs === null
        ? null
        : Timestamp.fromMillis(state.record.expiresAtMs),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return state.projection;
}

export async function getCanonicalAgeEligibilityForUid(uid: string) {
  const normalizedUid = cleanId(uid);

  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const snapshot = await db
    .collection('age_eligibility_records')
    .doc(normalizedUid)
    .get();

  return evaluateCanonicalAgeEligibility({
    uid: normalizedUid,
    rawRecord: snapshot.exists ? snapshot.data() : null,
  });
}

export async function assertVerifiedAdultAgeEligibility(
  uid: string
): Promise<void> {
  const decision = await getCanonicalAgeEligibilityForUid(uid);

  if (decision.allowed) return;

  const code = decision.denialReason === 'underage'
    ? 'permission-denied'
    : 'failed-precondition';

  throw new HttpsError(
    code,
    decision.denialReason === 'underage'
      ? 'O acesso adulto não está disponível para esta conta.'
      : 'Conclua a verificação de maioridade para continuar.',
    {
      reason: decision.denialReason,
      recommendedAction:
        decision.denialReason === 'review_required'
          ? 'complete_age_review'
          : 'complete_age_verification',
    }
  );
}
