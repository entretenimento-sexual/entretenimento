// src/app/core/interfaces/friendship/friend.interface.ts
import { Timestamp } from 'firebase/firestore';
export interface Friend {
  friendUid: string;
  since?: Timestamp;
  lastInteractionAt?: Timestamp;
  nickname?: string;
  distanceKm?: number;
}
