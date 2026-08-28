// src/app/core/interfaces/interfaces-chat/invite.interface.ts
import type { FieldValue, Timestamp } from 'firebase/firestore';

/**
 * Este contrato pertence exclusivamente ao domínio de salas de conversa.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - `community` e `friend` foram removidos de InviteType;
 * - solicitações de conexão continuam em FriendRequest/friendRequests;
 * - futuros convites comunitários terão contrato, Store e callables próprios.
 */
export type InviteType = 'room';
export type InviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'canceled';

/**
 * Documento de convite para sala recebido diretamente do Firestore.
 * Não deve atravessar a borda do NgRx porque contém Timestamp/FieldValue.
 */
export interface RoomInvite {
  id?: string;

  type?: 'room';
  targetId?: string;
  targetName?: string;

  senderId: string;
  receiverId: string;
  status: InviteStatus;
  sentAt: Timestamp;
  expiresAt: Timestamp;

  respondedAt?: Timestamp | FieldValue | null;
  updatedAt?: Timestamp | FieldValue;

  // Compatibilidade com documentos de sala anteriores ao contrato v2.
  roomId?: string;
  roomName?: string;
}

/** Nome público legado preservado para os consumidores existentes. */
export type Invite = RoomInvite;

/**
 * Projeção plain/serializável do inbox de salas.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - Timestamp e FieldValue são convertidos para epoch em milissegundos;
 * - campos ausentes são normalizados para null;
 * - somente esta projeção pode ser enviada para actions/reducers/selectors.
 */
export interface InviteInboxItem {
  readonly id: string;
  readonly type: 'room' | null;
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
