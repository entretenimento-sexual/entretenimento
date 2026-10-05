interface PublicProfileProjectionAccount {
  publicVisibility?: unknown;
  interactionBlocked?: unknown;
  suspended?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  accountStatus?: unknown;
}

/**
 * Fail-closed para projeções públicas derivadas do documento privado do usuário.
 *
 * Um trigger atrasado nunca pode recriar public_profiles/{uid} enquanto a conta
 * estiver escondida, bloqueada, suspensa ou fora do lifecycle ativo.
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
  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  return accountStatus !== 'active' ||
    visibility === 'hidden' ||
    visibility === 'private' ||
    user.interactionBlocked === true ||
    user.suspended === true ||
    user.accountLocked === true ||
    user.loginAllowed === false;
}
