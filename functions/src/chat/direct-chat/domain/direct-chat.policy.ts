// functions/src/chat/direct-chat/domain/direct-chat.policy.ts
// -----------------------------------------------------------------------------
// DIRECT CHAT POLICY
// -----------------------------------------------------------------------------
// Regras específicas de criação/resolução de conversas diretas.
//
// Princípios desta fase:
// - assinatura/plano não substitui consentimento;
// - conversa nova exige amizade aceita materializada nos dois perfis;
// - conversa legada existente pode ser adotada durante a migração;
// - lifecycle da conta é validado pela policy compartilhada de mensageria;
// - bloqueio bilateral é obrigatório antes de resolver/adotar/criar qualquer chat.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';
import type { BackendFixedWindowRateLimitConfig } from '../../../shared/security/backend-fixed-window-rate-limit';

export const DIRECT_CHAT_POLICY_VERSION = 'direct-chat-v1' as const;

export const ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig = {
  burstWindowMs: 60_000,
  burstMax: 30,
  sustainedWindowMs: 60 * 60_000,
  sustainedMax: 300,
};

export const ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT = 11;

export interface DirectChatConsentContext {
  actorHasAcceptedFriendEdge: boolean;
  targetHasAcceptedFriendEdge: boolean;
}

/**
 * Autoriza a criação de uma NOVA conversa direta.
 *
 * Não é aplicada à adoção de uma conversa legada já existente, porque essa
 * thread pode conter histórico válido dos usuários.
 */
export function assertCanCreateNewDirectChat(
  consent: DirectChatConsentContext
): void {
  if (
    consent.actorHasAcceptedFriendEdge !== true ||
    consent.targetHasAcceptedFriendEdge !== true
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Para iniciar uma conversa direta, a conexão precisa estar aceita.'
    );
  }
}
/**
 * Não adota nem retorna uma conversa que o contrato de envio rejeitaria.
 * A ausência de type/status permanece compatível com históricos antigos,
 * mas valores explícitos inválidos, salas e participantes extras falham.
 */
export function isEligibleExistingDirectChat(
  chat: {
    participants?: unknown;
    isRoom?: unknown;
    conversationType?: unknown;
    conversationStatus?: unknown;
  } | null | undefined,
  participants: readonly string[]
): boolean {
  if (!chat || chat.isRoom === true || participants.length !== 2) return false;
  if (participants[0] === participants[1] ||
      participants.some((uid) => !uid)) return false;

  const kind = String(chat.conversationType ?? '').trim().toLowerCase();
  const status = String(chat.conversationStatus ?? '').trim().toLowerCase();
  if ((kind && kind !== 'direct') || (status && status !== 'active')) {
    return false;
  }

  if (!Array.isArray(chat.participants) || chat.participants.length !== 2) {
    return false;
  }

  const actual = chat.participants.map((value) =>
    typeof value === 'string' ? value.trim() : ''
  ).sort();
  const expected = [...participants].sort();
  return actual[0] !== '' && actual[1] !== ''
    && actual[0] !== actual[1]
    && actual[0] === expected[0] && actual[1] === expected[1];
}
