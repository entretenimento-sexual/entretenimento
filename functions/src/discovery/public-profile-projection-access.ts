import {
  hasCurrentTrustedAdultAgeProjection,
} from '../account_lifecycle/trusted-adult-account-assurance.policy';

interface PublicProfileProjectionAccount {
  publicVisibility?: unknown;
  interactionBlocked?: unknown;
  suspended?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

/**
 * Fail-closed para projeções públicas derivadas do documento privado do usuário.
 *
 * Um trigger atrasado nunca pode recriar public_profiles/{uid} enquanto a conta
 * estiver sem assurance adulta confiável, escondida, bloqueada, suspensa ou
 * em reverificação.
 */
export function isPublicProfileProjectionBlocked(
  user: PublicProfileProjectionAccount | null | undefined
): boolean {
  if (!user) {
    return true;
  }

  const visibility = String(user.publicVisibility ?? '')
    .trim()
    .toLowerCase();
  const ageStatus = String(user.ageReverification?.status ?? '')
    .trim()
    .toUpperCase();

  return !hasCurrentTrustedAdultAgeProjection(user) ||
    visibility === 'hidden' ||
    visibility === 'private' ||
    user.interactionBlocked === true ||
    user.suspended === true ||
    user.accountLocked === true ||
    user.loginAllowed === false ||
    ageStatus === 'REQUIRED' ||
    ageStatus === 'SUBMITTED';
}
