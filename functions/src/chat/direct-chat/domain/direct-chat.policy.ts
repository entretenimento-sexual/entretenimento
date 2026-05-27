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
// - bloqueio bilateral será integrado quando o contrato persistido existir.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export const DIRECT_CHAT_POLICY_VERSION = 'direct-chat-v1' as const;

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