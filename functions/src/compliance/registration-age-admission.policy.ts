import {
  isAdultAccountAdmissionDecision,
  isTrustedAdultAgeDecision,
  type AgeEligibilityDecision,
} from './age-eligibility.policy';

export type RegistrationAgeAdmissionMode = 'SELF_DECLARATION' | 'VERIFIED_REQUIRED';

export function resolveRegistrationAgeAdmissionMode(value: string | undefined): RegistrationAgeAdmissionMode {
  const mode = (value ?? 'SELF_DECLARATION').trim().toUpperCase();
  // Uma configuração explícita inválida não deve liberar admissão por declaração.
  return mode === 'SELF_DECLARATION' ? 'SELF_DECLARATION' : 'VERIFIED_REQUIRED';
}

export const registrationAgeAdmissionMode = resolveRegistrationAgeAdmissionMode(process.env.AGE_ADMISSION_MODE);
export const requiresTrustedAdultVerification = registrationAgeAdmissionMode === 'VERIFIED_REQUIRED';
export const TRUSTED_AGE_VERIFICATION_REQUIRED = 'trusted_age_verification_required';

export function isRegistrationAgeAdmitted(
  decision: Readonly<AgeEligibilityDecision>,
  mode: RegistrationAgeAdmissionMode = registrationAgeAdmissionMode,
): boolean {
  return mode === 'VERIFIED_REQUIRED'
    ? isTrustedAdultAgeDecision(decision)
    : isAdultAccountAdmissionDecision(decision);
}
