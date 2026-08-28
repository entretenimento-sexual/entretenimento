// src/app/core/interfaces/friendship/blocked-user.interface.ts
import { Timestamp, FieldValue } from 'firebase/firestore';

/** Estado atual do bloqueio */
export interface BlockedUserActive {
  uid: string;               // alvo do bloqueio
  isBlocked: boolean;        // ativo?
  blockedAt?: Timestamp | null;
  unblockedAt?: Timestamp | null;
  reason?: string;
  actorUid: string;          // quem executou a ação
  updatedAt: Timestamp | null;
}

/** Tipos de evento registrados na trilha */
export type BlockEventType = 'block' | 'unblock';

/** Evento imutável de auditoria */
export interface BlockEvent {
  type: BlockEventType;
  targetUid: string;
  reason?: string;
  actorUid?: string;
  createdAt: Timestamp | FieldValue; // serverTimestamp()
}
