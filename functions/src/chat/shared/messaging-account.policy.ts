// functions/src/chat/shared/messaging-account.policy.ts
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
  return String(user?.accountStatus ?? 'active').trim().toLowerCase();
}

function actorProfileIncompleteMessage(operation: MessagingOperation): string {
  switch (operation) {
  case 'create-private-room':
    return 'Complete seu perfil antes de criar uma sala.';
  case 'close-private-room':
    return 'Complete seu perfil antes de encerrar uma sala.';
  case 'send-room-invite':
    return 'Complete seu perfil antes de convidar pessoas para salas.';
  case 'accept-room-invite':
  case 'decline-room-invite':
    return 'Complete seu perfil antes de responder a convites de sala.';
  case 'publish-user-intent-status':
    return 'Complete seu perfil antes de publicar seu status.';
  case 'hide-user-intent-status':
    return 'Complete seu perfil antes de encerrar seu status.';
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
  case 'close-private-room':
    return 'Sua conta não está disponível para encerrar salas.';
  case 'send-room-invite':
    return 'Sua conta não está disponível para enviar convites de sala.';
  case 'accept-room-invite':
  case 'decline-room-invite':
    return 'Sua conta não está disponível para responder a convites de sala.';
  case 'publish-user-intent-status':
    return 'Sua conta não está disponível para publicar status.';
  case 'hide-user-intent-status':
    return 'Sua conta não está disponível para encerrar status.';
  case 'ensure-direct-chat':
    return 'Sua conta não está disponível para iniciar conversas.';
  case 'send-direct-message':
    return 'Sua conta não está disponível para enviar mensagens.';
  case 'create-message-request':
    return 'Sua conta não está disponível para solicitar conversas.';
  }
}

function targetUnavailableMessage(): string {
  return 'Este perfil não está disponível para mensagens.';
}

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

  const unavailable =
    normalizedAccountStatus(user) !== 'active' ||
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
