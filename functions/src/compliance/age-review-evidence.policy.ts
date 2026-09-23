// functions/src/compliance/age-review-evidence.policy.ts
// -----------------------------------------------------------------------------
// TRUSTED AGE REVIEW EVIDENCE
// -----------------------------------------------------------------------------
// Normaliza a referência usada por revisão humana de maioridade.
//
// Segurança:
// - a referência bruta nunca é persistida;
// - documento, CPF, nome civil ou data de nascimento não pertencem a este
//   contrato;
// - a decisão final continua exclusiva do backend/moderação autorizada;
// - autodeclaração não é método de evidência aceito.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export type AgeReviewEvidenceMethod =
  | 'MANUAL_DOCUMENT_REVIEW'
  | 'PROVIDER_ESCALATION'
  | 'PROFILE_KYC';

export interface AgeReviewEvidence {
  method: AgeReviewEvidenceMethod;
  referenceHash: string;
}

function normalizeMethod(value: unknown): AgeReviewEvidenceMethod | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return normalized === 'MANUAL_DOCUMENT_REVIEW' ||
    normalized === 'PROVIDER_ESCALATION' ||
    normalized === 'PROFILE_KYC'
    ? normalized
    : null;
}

function normalizeReference(value: unknown): string {
  return Array.from(String(value ?? ''))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 300);
}

export function normalizeAgeReviewEvidence(input: {
  method: unknown;
  reference: unknown;
}): Readonly<AgeReviewEvidence> | null {
  const method = normalizeMethod(input.method);
  const reference = normalizeReference(input.reference);

  if (!method || reference.length < 8) {
    return null;
  }

  return Object.freeze({
    method,
    referenceHash: createHash('sha256')
      .update(reference)
      .digest('hex'),
  });
}
