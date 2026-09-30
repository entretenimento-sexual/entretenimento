export const DIRECT_CHAT_MAX_MESSAGE_LENGTH = 1000;
export const DIRECT_CHAT_NEAR_LIMIT_RATIO = 0.85;

export function normalizeDirectMessageContent(value: unknown): string {
  return String(value ?? '');
}

export function trimDirectMessageContent(value: unknown): string {
  return normalizeDirectMessageContent(value).trim();
}

export function directMessageLength(value: unknown): number {
  return normalizeDirectMessageContent(value).length;
}

export function isDirectMessageTooLong(
  value: unknown,
  maxLength = DIRECT_CHAT_MAX_MESSAGE_LENGTH
): boolean {
  return directMessageLength(value) > maxLength;
}

export function isDirectMessageNearLimit(
  value: unknown,
  maxLength = DIRECT_CHAT_MAX_MESSAGE_LENGTH,
  ratio = DIRECT_CHAT_NEAR_LIMIT_RATIO
): boolean {
  return directMessageLength(value) >= Math.floor(maxLength * ratio);
}

export function resolveDirectMessageBlockMessage(
  error: unknown
): string | null {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
    .toLowerCase();

  const message = String(
    (error as { message?: unknown } | null)?.message ?? ''
  ).toLowerCase();

  if (
    code.includes('failed-precondition') &&
    message.includes('conexão precisa estar aceita')
  ) {
    return 'Vocês precisam estar conectados para trocar mensagens.';
  }

  if (
    code.includes('failed-precondition') &&
    message.includes('verifique seu e-mail')
  ) {
    return 'Verifique seu e-mail antes de enviar mensagens.';
  }

  if (
    code.includes('failed-precondition') &&
    message.includes('complete seu perfil')
  ) {
    return 'Complete seu perfil antes de enviar mensagens.';
  }

  if (code.includes('permission-denied')) {
    return 'Esta conversa não está disponível para envio.';
  }

  return null;
}
