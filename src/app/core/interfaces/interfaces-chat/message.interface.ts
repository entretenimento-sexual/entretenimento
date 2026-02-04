// src/app/core/interfaces/interfaces-chat/message.interface.ts
// Não esqueça os comentários
import { Timestamp } from 'firebase/firestore';

export interface Message {
  id?: string;
  content: string;
  senderId: string; // mantém
  nickname: string;
  timestamp: Timestamp;
  status?: 'sent' | 'delivered' | 'read';

  // ✅ compat opcional (sem quebrar o app)
  senderUid?: string;
  createdAt?: Timestamp;
}
