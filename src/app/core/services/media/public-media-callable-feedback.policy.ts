export type PublicMediaCallableAction =
  | 'reaction'
  | 'comment'
  | 'reply'
  | 'rating'
  | 'moderation';

type PublicMediaConsumptionAccessReason =
  | 'ACCOUNT_UNAVAILABLE'
  | 'TERMS_REQUIRED'
  | 'ADULT_CONSENT_REQUIRED'
  | 'AGE_REVERIFICATION_REQUIRED';

interface CallableErrorLike {
  code?: unknown;
  details?: { reason?: unknown } | null;
  original?: {
    code?: unknown;
    details?: { reason?: unknown } | null;
  } | null;
}

function readErrorCandidate(error: unknown): CallableErrorLike | null {
  return error && typeof error === 'object'
    ? error as CallableErrorLike
    : null;
}

function readErrorCode(error: unknown): string {
  const candidate = readErrorCandidate(error);
  if (!candidate) {
    return '';
  }

  const rawCode = String(
    candidate.code ?? candidate.original?.code ?? ''
  )
    .trim()
    .toLowerCase();

  if (!rawCode) {
    return '';
  }

  const segments = rawCode.split('/').filter(Boolean);
  return segments.at(-1) ?? rawCode;
}

function readConsumptionAccessReason(
  error: unknown
): PublicMediaConsumptionAccessReason | null {
  const candidate = readErrorCandidate(error);
  const rawReason = String(
    candidate?.details?.reason ??
    candidate?.original?.details?.reason ??
    ''
  )
    .trim()
    .toUpperCase();

  if (
    rawReason === 'ACCOUNT_UNAVAILABLE' ||
    rawReason === 'TERMS_REQUIRED' ||
    rawReason === 'ADULT_CONSENT_REQUIRED' ||
    rawReason === 'AGE_REVERIFICATION_REQUIRED'
  ) {
    return rawReason;
  }

  return null;
}

function consumptionAccessMessage(
  reason: PublicMediaConsumptionAccessReason
): string {
  if (reason === 'ACCOUNT_UNAVAILABLE') {
    return 'Sua conta não está disponível para esta interação.';
  }

  if (reason === 'TERMS_REQUIRED') {
    return 'Aceite os termos e a política de privacidade atuais para continuar.';
  }

  if (reason === 'ADULT_CONSENT_REQUIRED') {
    return 'Confirme o consentimento para conteúdo adulto para continuar.';
  }

  return 'Conclua a revalidação de idade para continuar.';
}

function actionUnavailableMessage(action: PublicMediaCallableAction): string {
  if (action === 'reaction') {
    return 'Esta reação não está disponível no momento.';
  }

  if (action === 'comment') {
    return 'Não foi possível publicar este comentário agora.';
  }

  if (action === 'reply') {
    return 'Não foi possível responder este comentário agora.';
  }

  if (action === 'rating') {
    return 'Esta avaliação não está disponível no momento.';
  }

  return 'Esta ação de moderação não está disponível no momento.';
}

function rateLimitMessage(action: PublicMediaCallableAction): string {
  if (action === 'reaction') {
    return 'Muitas reações em pouco tempo. Aguarde um momento e tente novamente.';
  }

  if (action === 'comment' || action === 'reply') {
    return 'Muitos comentários em pouco tempo. Aguarde um momento e tente novamente.';
  }

  if (action === 'rating') {
    return 'Muitas avaliações em pouco tempo. Aguarde um momento e tente novamente.';
  }

  return 'Muitas ações em pouco tempo. Aguarde um momento e tente novamente.';
}

export function resolvePublicMediaCallableUserMessage(
  error: unknown,
  action: PublicMediaCallableAction,
  fallback: string
): string {
  const code = readErrorCode(error);

  if (code === 'resource-exhausted') {
    return rateLimitMessage(action);
  }

  if (code === 'unauthenticated') {
    return 'Sua sessão expirou. Entre novamente para continuar.';
  }

  if (code === 'permission-denied') {
    return 'Você não tem permissão para realizar esta ação.';
  }

  if (code === 'not-found') {
    return 'Este conteúdo não está mais disponível.';
  }

  if (code === 'failed-precondition') {
    const accessReason = readConsumptionAccessReason(error);
    return accessReason
      ? consumptionAccessMessage(accessReason)
      : actionUnavailableMessage(action);
  }

  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'O serviço está temporariamente indisponível. Tente novamente em instantes.';
  }

  return fallback;
}
