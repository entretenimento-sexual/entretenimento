// message.interface.ts
import { Timestamp } from "@firebase/firestore";

export interface Message {
  id?: string;
  content: string;
  senderId: string; // ID do usuário remetente
  timestamp: Timestamp;
}
