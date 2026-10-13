/**
 * Contrato de domínio da projeção de não lidas (ainda não ativada).
 *
 * Uma projeção é individual por participante, não uma contagem global do chat.
 * Replays da mesma mensagem devem ser idempotentes e mudanças de recibo só
 * alteram o total quando cruzam o limite entre não lida e lida.
 *
 * NÃO é uma autorização de leitura: lifecycle e bloqueio continuam nas
 * políticas canônicas do backend e nas Firestore Rules.
 */
export type DirectReceiptStatus = 'sent' | 'delivered' | 'read';

export interface DirectUnreadProjection {
  version: 1;
  chatId: string;
  participantUid: string;
  unreadCount: number;
}

export interface DirectUnreadMessage {
  messageId: string;
  senderUid: string;
  status: DirectReceiptStatus;
  deleted?: boolean;
}

/** Mensagem entregue ainda não é mensagem lida. */
export function isDirectMessageUnread(
  message: DirectUnreadMessage,
  participantUid: string
): boolean {
  return message.senderUid !== participantUid &&
    message.deleted !== true &&
    (message.status === 'sent' || message.status === 'delivered');
}

/**
 * Resultado para uma transição de estado já validada pelo backend.
 * Não incrementa em sent -> delivered e nunca permite total negativo.
 * Quem persistir a projeção deverá fazê-lo em transação e com controle
 * de versão/evento, para impedir reprocessamento ou perda concorrente.
 */
export function applyDirectUnreadTransition(
  count: number,
  previous: DirectUnreadMessage | null,
  next: DirectUnreadMessage | null,
  participantUid: string
): number {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid unread projection count');
  }
  const before = previous ? Number(isDirectMessageUnread(previous, participantUid)) : 0;
  const after = next ? Number(isDirectMessageUnread(next, participantUid)) : 0;
  return Math.max(0, count + after - before);
}
