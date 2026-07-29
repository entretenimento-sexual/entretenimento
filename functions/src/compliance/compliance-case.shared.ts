import { HttpsError } from 'firebase-functions/v2/https';

export type ComplianceCaseCategory =
  | 'AGE_OR_IDENTITY'
  | 'NON_CONSENSUAL_CONTENT'
  | 'ILLEGAL_CONTENT'
  | 'HARASSMENT_OR_THREAT'
  | 'FRAUD_OR_PAYMENT_ABUSE'
  | 'ACCOUNT_INTEGRITY'
  | 'OTHER_TERMS_VIOLATION';

export type ComplianceCaseStatus =
  | 'AWAITING_USER_RESPONSE'
  | 'USER_RESPONDED'
  | 'UNDER_REVIEW'
  | 'RESOLVED_NO_VIOLATION'
  | 'RESOLVED_ACTION_TAKEN'
  | 'CLOSED';

export const COMPLIANCE_CASE_CATEGORIES: readonly ComplianceCaseCategory[] = [
  'AGE_OR_IDENTITY',
  'NON_CONSENSUAL_CONTENT',
  'ILLEGAL_CONTENT',
  'HARASSMENT_OR_THREAT',
  'FRAUD_OR_PAYMENT_ABUSE',
  'ACCOUNT_INTEGRITY',
  'OTHER_TERMS_VIOLATION',
];

export const DEFAULT_RESPONSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const MIN_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MAX_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('');
}

export function normalizeComplianceText(
  value: unknown,
  fieldLabel: string,
  minLength: number,
  maxLength: number
): string {
  const normalized = replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new HttpsError(
      'invalid-argument',
      `${fieldLabel} deve ter entre ${minLength} e ${maxLength} caracteres.`
    );
  }

  return normalized;
}

export function normalizeComplianceCategory(
  value: unknown
): ComplianceCaseCategory {
  const normalized = String(value ?? '').trim().toUpperCase();

  if (!COMPLIANCE_CASE_CATEGORIES.includes(
    normalized as ComplianceCaseCategory
  )) {
    throw new HttpsError(
      'invalid-argument',
      'Categoria de conformidade inválida.'
    );
  }

  return normalized as ComplianceCaseCategory;
}

export function normalizeResponseDueAt(
  value: unknown,
  now: number
): number {
  if (value == null) {
    return now + DEFAULT_RESPONSE_WINDOW_MS;
  }

  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  const windowMs = normalized - now;

  if (
    windowMs < MIN_RESPONSE_WINDOW_MS ||
    windowMs > MAX_RESPONSE_WINDOW_MS
  ) {
    throw new HttpsError(
      'invalid-argument',
      'O prazo de manifestação deve ficar entre 1 e 30 dias.'
    );
  }

  return normalized;
}
