// functions/src/chat/shared/messaging.types.ts
// Contratos mínimos compartilhados pelos produtos de mensageria.
export type MessagingAccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type MessagingOperation =
  | 'create-private-room'
  | 'close-private-room'
  | 'send-room-invite'
  | 'accept-room-invite'
  | 'decline-room-invite'
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
