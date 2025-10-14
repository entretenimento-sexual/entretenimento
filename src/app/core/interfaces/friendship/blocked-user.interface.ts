// src/app/core/interfaces/friendship/blocked-user.interface.ts
import { Timestamp } from 'firebase/firestore';
export interface BlockedUser {
  uid: string;
  reason?: string;
  blockedAt: Timestamp | null; // null quando desbloquear (se seguir a opção 2)
}
