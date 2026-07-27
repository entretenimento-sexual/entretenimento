// src/app/core/interfaces/interfaces-chat/invite.interface.ts
import type { FieldValue, Timestamp } from 'firebase/firestore';

export type InviteType = 'room' | 'community' | 'friend';
export type InviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'canceled';

/**
 * Documento de domínio recebido diretamente do Firestore.
 * Não deve atravessar a borda do NgRx porque contém Timestamp/FieldValue.
 */
export interface Invite {
  id?: string;

  // v2
  type?: InviteType;
  targetId?: string;
  targetName?: string;

  // canônico
  senderId: string;
  receiverId: string;
  status: InviteStatus;
  sentAt: Timestamp;
  expiresAt: Timestamp;

  // audit
  respondedAt?: Timestamp | FieldValue | null;
  updatedAt?: Timestamp | FieldValue;

  // legacy room
  roomId?: string;
  roomName?: string;
}

/**
 * Projeção plain/serializável do inbox.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - Timestamp e FieldValue são convertidos para epoch em milissegundos;
 * - campos ausentes são normalizados para null;
 * - somente esta projeção pode ser enviada para actions/reducers/selectors.
 */
export interface InviteInboxItem {
  readonly id: string;
  readonly type: InviteType | null;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly senderId: string;
  readonly receiverId: string;
  readonly status: InviteStatus;
  readonly sentAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly roomId: string | null;
  readonly roomName: string | null;
}
