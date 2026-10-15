/**
 * Classifica respostas de falha da callable de acesso. Não é autoridade
 * de autorização: somente o backend concede URL e o lifecycle governa conta.
 */
export type PublicVideoAccessRefreshFailure =
  | 'permission-denied'
  | 'unauthenticated'
  | 'not-found'
  | 'resource-exhausted'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'unknown';

type ErrorCandidate = {
  code?: unknown;
  details?: { reason?: unknown } | null;
  original?: {
    code?: unknown;
    details?: { reason?: unknown } | null;
  } | null;
};

export function classifyPublicVideoAccessRefreshFailure(
  error: unknown
): PublicVideoAccessRefreshFailure {
  if (!error || typeof error !== 'object') return 'unknown';
  const candidate = error as ErrorCandidate;
  const reason = String(
    candidate.details?.reason ?? candidate.original?.details?.reason ?? ''
  ).trim().toUpperCase();
  // Razões canônicas da conta são uma restrição real, não falha de rede.
  if (reason === 'ACCOUNT_UNAVAILABLE' ||
      reason === 'TERMS_REQUIRED' ||
      reason === 'ADULT_CONSENT_REQUIRED') {
    return 'permission-denied';
  }
  const rawCode = String(candidate.code ?? candidate.original?.code ?? '')
    .trim().toLowerCase();
  const code = rawCode.split('/').filter(Boolean).at(-1) ?? rawCode;
  if (rawCode === 'auth/user-token-expired') return 'unauthenticated';
  if (rawCode === 'storage/unauthorized') return 'permission-denied';
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
    case 'not-found':
    case 'resource-exhausted':
    case 'unavailable':
    case 'deadline-exceeded':
      return code;
    default:
      return 'unknown';
  }
}
