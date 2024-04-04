// src\app\core\interfaces\interfaces-chat\invite.interface.ts
import { Timestamp } from 'firebase/firestore';
export interface Invite {
  id?: string;
  roomId: string;
  senderId: string;
  receiverId: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined';
  sentAt: Timestamp;
  expiresAt: Timestamp;
}
