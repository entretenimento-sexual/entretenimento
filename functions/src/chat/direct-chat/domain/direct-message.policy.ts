// functions/src/chat/direct-chat/domain/direct-message.policy.ts
// -----------------------------------------------------------------------------
// DIRECT MESSAGE POLICY
// -----------------------------------------------------------------------------
// Regras específicas para envio de mensagens em conversas diretas.
//
// Princípios:
// - conteúdo é validado no backend;
// - conversa precisa ser direta e conter exatamente dois participantes;
// - apenas participante da conversa pode enviar;
// - bloqueio bilateral impede novo envio;
// - chat legado sem conversationType/conversationStatus permanece compatível.
// -----------------------------------------------------------------------------
import { HttpsError } from 'firebase-functions/v2/https';

export const DIRECT_MESSAGE_POLICY_VERSION = 'direct-message-v1' as const;
export const DIRECT_MESSAGE_MAX_LENGTH = 1000;
export const DIRECT_MESSAGE_MAX_RAW_LENGTH = 4000;

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface DirectChatDocumentForSend {
  participants?: unknown;
  isRoom?: unknown;
  conversationType?: unknown;
  conversationStatus?: unknown;
}

export interface DirectMessageBlockContext {
  actorBlockedTarget: boolean;
  targetBlockedActor: boolean;
}

export function normalizeDirectMessageContent(value: unknown): string {
  const rawContent = String(value ?? '');

  if (rawContent.length > DIRECT_MESSAGE_MAX_RAW_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      'A mensagem excede o limite permitido.'
    );
  }

  const normalizedContent = rawContent
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional de texto informado pelo usuário.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  if (!normalizedContent) {
    throw new HttpsError(
      'invalid-argument',
      'A mensagem não pode ser vazia.'
    );
  }

  if (normalizedContent.length > DIRECT_MESSAGE_MAX_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `A mensagem deve ter no máximo ${DIRECT_MESSAGE_MAX_LENGTH} caracteres.`
    );
  }

  return normalizedContent;
}

export function normalizeDirectMessageRequestId(value: unknown): string {
  const requestId = String(value ?? '').trim();

  if (!CLIENT_REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpsError(
      'invalid-argument',
      'Identificador de envio inválido.'
    );
  }

  return requestId;
}

export function resolveDirectMessageTargetUid(
  chat: DirectChatDocumentForSend | undefined,
  actorUid: string
): string {
  if (!chat || chat.isRoom === true) {
    throw new HttpsError(
      'failed-precondition',
      'Esta conversa não está disponível para mensagens.'
    );
  }

  const conversationType = String(chat.conversationType ?? '')
    .trim()
    .toLowerCase();

  if (conversationType && conversationType !== 'direct') {
    throw new HttpsError(
      'failed-precondition',
      'Esta conversa não está disponível para mensagens.'
    );
  }

  const conversationStatus = String(chat.conversationStatus ?? '')
    .trim()
    .toLowerCase();

  if (conversationStatus && conversationStatus !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Esta conversa não está disponível para mensagens.'
    );
  }

  if (!Array.isArray(chat.participants)) {
    throw new HttpsError(
      'permission-denied',
      'Esta conversa não está disponível.'
    );
  }

  const participants = Array.from(
    new Set(
      chat.participants
        .map((participant) => String(participant ?? '').trim())
        .filter(Boolean)
    )
  );

  if (participants.length !== 2 || !participants.includes(actorUid)) {
    throw new HttpsError(
      'permission-denied',
      'Esta conversa não está disponível.'
    );
  }

  const targetUid = participants.find((participant) => participant !== actorUid);

  if (!targetUid) {
    throw new HttpsError(
      'permission-denied',
      'Esta conversa não está disponível.'
    );
  }

  return targetUid;
}

export function assertNoDirectMessagingBlock(
  context: DirectMessageBlockContext
): void {
  if (context.actorBlockedTarget || context.targetBlockedActor) {
    throw new HttpsError(
      'permission-denied',
      'Esta conversa não está disponível para mensagens.'
    );
  }
}