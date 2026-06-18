// functions/src/chat/shared/messaging.types.ts
// -----------------------------------------------------------------------------
// MESSAGING SHARED TYPES
// -----------------------------------------------------------------------------
// Contratos mínimos compartilhados pelos produtos de mensageria.
//
// Escopo atual:
// - salas privadas;
// - status de intenção;
// - conversas diretas;
// - futuros pedidos de mensagem.
//
// Segurança:
// - estes tipos não autorizam ações isoladamente;
// - handlers devem sempre usar as policies correspondentes;
// - dados do cliente nunca substituem leitura confiável feita pelo backend.
// -----------------------------------------------------------------------------
export type MessagingAccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type MessagingOperation =
  | 'create-private-room'
  | 'close-private-room'
  | 'publish-user-intent-status'
  | 'hide-user-intent-status'
  | 'ensure-direct-chat'
  | 'send-direct-message'
  | 'create-message-request';

export type MessagingPerspective = 'actor' | 'target';

export interface MessagingUserDoc {
  uid?: string;
  nickname?: string | null;

  profileCompleted?: boolean;

  accountStatus?: MessagingAccountStatus | string | null;
  interactionBlocked?: boolean | null;
  accountLocked?: boolean | null;
  loginAllowed?: boolean | null;

  role?: string | null;
  photoURL?: string | null;
  publicVisibility?: 'visible' | 'hidden' | string | null;
}
