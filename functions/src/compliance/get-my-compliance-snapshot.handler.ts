// functions/src/compliance/get-my-compliance-snapshot.handler.ts
// -----------------------------------------------------------------------------
// GET MY COMPLIANCE SNAPSHOT
// -----------------------------------------------------------------------------
//
// Devolve somente uma projeção sanitizada do estado adulto, KYC, conta de
// repasse e AML do usuário autenticado.
//
// Nenhum documento, biometria, CPF, referência secreta, flag de sanções ou
// payload bruto de provedor é retornado ao navegador.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  ACCOUNT_STATUS_VALUES,
  AGE_VERIFICATION_STATUS_VALUES,
  AML_RISK_TIER_VALUES,
  ComplianceAccountStatus,
  derivePayoutEligibility,
  IDENTITY_VERIFICATION_STATUS_VALUES,
  IdentityVerificationStatus,
  MyComplianceSnapshot,
  PAYOUT_ACCOUNT_STATUS_VALUES,
  PayoutAccountStatus,
  AgeVerificationStatus,
  AmlRiskTier,
} from './compliance.model';

interface UserComplianceSource {
  adultConsent?: {
    accepted?: unknown;
  } | null;
  accountStatus?: unknown;
  suspended?: unknown;
  accountLocked?: unknown;
  interactionBlocked?: unknown;
  loginAllowed?: unknown;
  deletionRequestedAt?: unknown;
  deletedAt?: unknown;
}

interface ComplianceProfileSource {
  ageVerificationStatus?: unknown;
  ageVerifiedAt?: unknown;
  identityVerificationStatus?: unknown;
  identityVerificationProvider?: unknown;
  identityVerificationUpdatedAt?: unknown;
  amlRiskTier?: unknown;
  lastRiskReviewAt?: unknown;
}

interface PayoutAccountSource {
  status?: unknown;
  payoutAccountStatus?: unknown;
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return typeof value === 'string' && allowedValues.includes(value as T);
}

function normalizeAgeVerificationStatus(
  value: unknown
): AgeVerificationStatus {
  return isAllowedValue(value, AGE_VERIFICATION_STATUS_VALUES)
    ? value
    : 'not_started';
}

function normalizeIdentityVerificationStatus(
  value: unknown
): IdentityVerificationStatus {
  return isAllowedValue(value, IDENTITY_VERIFICATION_STATUS_VALUES)
    ? value
    : 'not_started';
}

function normalizePayoutAccountStatus(value: unknown): PayoutAccountStatus {
  return isAllowedValue(value, PAYOUT_ACCOUNT_STATUS_VALUES)
    ? value
    : 'not_connected';
}

function normalizeAmlRiskTier(value: unknown): AmlRiskTier | null {
  return isAllowedValue(value, AML_RISK_TIER_VALUES) ? value : null;
}

function toEpochOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as {
    toMillis?: () => unknown;
    seconds?: unknown;
    nanoseconds?: unknown;
  };

  if (typeof source.toMillis === 'function') {
    try {
      const epoch = source.toMillis();
      return typeof epoch === 'number' && Number.isFinite(epoch)
        ? Math.trunc(epoch)
        : null;
    } catch {
      return null;
    }
  }

  if (typeof source.seconds === 'number' && Number.isFinite(source.seconds)) {
    const nanos =
      typeof source.nanoseconds === 'number' &&
      Number.isFinite(source.nanoseconds)
        ? source.nanoseconds
        : 0;

    return Math.trunc(source.seconds * 1_000 + nanos / 1_000_000);
  }

  return null;
}

/**
 * Consolida o lifecycle atual sem permitir que um campo legado permissivo
 * neutralize uma restrição mais forte.
 *
 * Exemplos fail-closed:
 * - `accountStatus: active` com `suspended: true` continua suspenso;
 * - timestamp de exclusão prevalece sobre status ativo legado;
 * - `loginAllowed: false` impede elegibilidade mesmo sem status migrado.
 */
function normalizeAccountStatus(
  value: unknown,
  source: {
    suspended: boolean;
    loginAllowed: boolean;
    deletionRequestedAt: unknown;
    deletedAt: unknown;
  }
): ComplianceAccountStatus {
  const explicitStatus = isAllowedValue(value, ACCOUNT_STATUS_VALUES)
    ? value
    : null;

  if (
    explicitStatus === 'deleted' ||
    toEpochOrNull(source.deletedAt) !== null
  ) {
    return 'deleted';
  }

  if (
    explicitStatus === 'pending_deletion' ||
    toEpochOrNull(source.deletionRequestedAt) !== null
  ) {
    return 'pending_deletion';
  }

  if (explicitStatus === 'self_suspended') {
    return 'self_suspended';
  }

  if (
    explicitStatus === 'moderation_suspended' ||
    source.suspended ||
    !source.loginAllowed
  ) {
    return 'moderation_suspended';
  }

  return 'active';
}

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const provider = value.trim().toLowerCase();

  return /^[a-z0-9_-]{1,64}$/.test(provider) ? provider : null;
}

export const getMyComplianceSnapshot = onCall<Record<string, never>>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<MyComplianceSnapshot> => {
    const uid = request.auth?.uid?.trim() ?? '';

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.'
      );
    }

    const [userSnapshot, complianceSnapshot, payoutAccountSnapshot] =
      await Promise.all([
        db.collection('users').doc(uid).get(),
        db.collection('compliance_profiles').doc(uid).get(),
        db.collection('payout_accounts').doc(uid).get(),
      ]);

    const user = (userSnapshot.data() ?? {}) as UserComplianceSource;
    const compliance = (complianceSnapshot.data() ??
      {}) as ComplianceProfileSource;
    const payoutAccount = (payoutAccountSnapshot.data() ??
      {}) as PayoutAccountSource;

    const adultConsentAccepted = user.adultConsent?.accepted === true;
    const ageVerificationStatus = normalizeAgeVerificationStatus(
      compliance.ageVerificationStatus
    );
    const identityVerificationStatus =
      normalizeIdentityVerificationStatus(
        compliance.identityVerificationStatus
      );
    const payoutAccountStatus = normalizePayoutAccountStatus(
      payoutAccount.payoutAccountStatus ?? payoutAccount.status
    );
    const amlRiskTier = normalizeAmlRiskTier(compliance.amlRiskTier);
    const accountLocked = user.accountLocked === true;
    const interactionBlocked = user.interactionBlocked === true;
    const accountStatus = normalizeAccountStatus(user.accountStatus, {
      suspended: user.suspended === true,
      loginAllowed: user.loginAllowed !== false,
      deletionRequestedAt: user.deletionRequestedAt,
      deletedAt: user.deletedAt,
    });

    const payoutEligibility = derivePayoutEligibility({
      adultConsentAccepted,
      ageVerificationStatus,
      identityVerificationStatus,
      payoutAccountStatus,
      amlRiskTier,
      accountStatus,
      accountLocked,
      interactionBlocked,
    });

    return {
      available: true,
      adultConsentStatus: adultConsentAccepted
        ? 'accepted'
        : 'not_accepted',
      ageVerificationStatus,
      ageVerifiedAt: toEpochOrNull(compliance.ageVerifiedAt),
      identityVerificationStatus,
      identityVerificationProvider: normalizeProvider(
        compliance.identityVerificationProvider
      ),
      identityVerificationUpdatedAt: toEpochOrNull(
        compliance.identityVerificationUpdatedAt
      ),
      payoutAccountStatus,
      amlRiskTier,
      lastRiskReviewAt: toEpochOrNull(compliance.lastRiskReviewAt),
      payoutEligibility,
      generatedAt: Date.now(),
    };
  }
);
