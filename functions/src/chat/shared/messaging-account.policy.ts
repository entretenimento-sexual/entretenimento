// functions/src/chat/shared/messaging-account.policy.ts
// -----------------------------------------------------------------------------
// MESSAGING ACCOUNT POLICY
// -----------------------------------------------------------------------------
// Política comum de lifecycle e disponibilidade operacional para mensageria.
//
// Esta policy responde apenas:
// - a conta existe?
// - o perfil está concluído?
// - a conta está ativa e apta a interagir?
//
// Esta policy NÃO responde:
// - se há amizade aceita;
// - se há bloqueio bilateral entre usuários;
// - se o plano permite criar sala;
// - se um perfil sem foto pode enviar pedido a desconhecido.
//
// Essas decisões pertencem às policies específicas de cada produto.
// --------------------------------------------------------------------
import { HttpsError } from 'firebase-functions/v2/https';

import type {
  MessagingOperation,
  MessagingPerspective,
  MessagingUserDoc,
} from './messaging.types';

interface AssertMessagingAccountOptions {
  operation: MessagingOperation;
  perspective: MessagingPerspective;
}

function normalizedAccountStatus(user: MessagingUserDoc | undefined): string {
  return String(user?.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
}

function actorProfileIncompleteMessage(operation: MessagingOperation): string {
  switch (operation) {
    case 'create-private-room':
      return 'Complete seu perfil antes de criar uma sala.';

    case 'ensure-direct-chat':
      return 'Complete seu perfil antes de iniciar conversas.';

    case 'send-direct-message':
      return 'Complete seu perfil antes de enviar mensagens.';

    case 'create-message-request':
      return 'Complete seu perfil antes de solicitar uma conversa.';
  }
}

function actorUnavailableMessage(operation: MessagingOperation): string {
  switch (operation) {
    case 'create-private-room':
      return 'Sua conta não está disponível para criar salas.';

    case 'ensure-direct-chat':
      return 'Sua conta não está disponível para iniciar conversas.';

    case 'send-direct-message':
      return 'Sua conta não está disponível para enviar mensagens.';

    case 'create-message-request':
      return 'Sua conta não está disponível para solicitar conversas.';
  }
}

function targetUnavailableMessage(): string {
  /**
   * Mensagem genérica de propósito.
   *
   * Não devemos revelar ao remetente se outro perfil foi suspenso,
   * bloqueado administrativamente, ocultado ou está em exclusão.
   */
  return 'Este perfil não está disponível para mensagens.';
}

/**
 * Garante que uma conta pode participar da operação de mensageria indicada.
 *
 * Regras universais nesta fase:
 * - documento de usuário precisa existir;
 * - perfil precisa estar concluído;
 * - accountStatus precisa ser active;
 * - interação não pode estar bloqueada;
 * - conta não pode estar travada;
 * - login não pode estar desabilitado.
 */
export function assertMessagingAccountOperational(
  user: MessagingUserDoc | undefined,
  options: AssertMessagingAccountOptions
): void {
  const { operation, perspective } = options;

  if (!user?.uid) {
    throw new HttpsError(
      perspective === 'actor' ? 'not-found' : 'failed-precondition',
      perspective === 'actor'
        ? 'Seu perfil não foi localizado.'
        : targetUnavailableMessage()
    );
  }

  if (user.profileCompleted !== true) {
    throw new HttpsError(
      'failed-precondition',
      perspective === 'actor'
        ? actorProfileIncompleteMessage(operation)
        : targetUnavailableMessage()
    );
  }

  const accountStatus = normalizedAccountStatus(user);

  const unavailable =
    accountStatus !== 'active' ||
    user.interactionBlocked === true ||
    user.accountLocked === true ||
    user.loginAllowed === false;

  if (unavailable) {
    throw new HttpsError(
      'permission-denied',
      perspective === 'actor'
        ? actorUnavailableMessage(operation)
        : targetUnavailableMessage()
    );
  }
}