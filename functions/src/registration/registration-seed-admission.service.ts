import { HttpsError } from 'firebase-functions/v2/https';

import { requiresTrustedAdultVerification } from '../compliance/adult-self-declaration-evidence';
import { evaluateCanonicalAgeEligibility, isTrustedAdultAgeDecision } from '../compliance/age-eligibility.policy';
import { db } from '../firebaseApp';

/** A evidência do UID e a criação do perfil privado pertencem à mesma transação. */
export async function canCreateRegistrationSeed(
  transaction: FirebaseFirestore.Transaction,
  uid: string,
): Promise<boolean> {
  if (!requiresTrustedAdultVerification) return true;

  const record = await transaction.get(db.collection('age_eligibility_records').doc(uid));
  return isTrustedAdultAgeDecision(evaluateCanonicalAgeEligibility({
    uid, rawRecord: record.data() ?? null,
  }));
}

export async function assertCanCreateRegistrationSeed(
  transaction: FirebaseFirestore.Transaction,
  uid: string,
): Promise<void> {
  if (await canCreateRegistrationSeed(transaction, uid)) return;

  throw new HttpsError('failed-precondition', 'Conclua a verificação confiável de maioridade antes de continuar.', {
    reason: 'trusted_age_verification_required',
  });
}
