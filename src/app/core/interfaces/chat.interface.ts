// chat.interface.ts
import { Timestamp } from "@firebase/firestore";
import { Message } from "./message.interface";
export interface Chat {
  id?: string;
  participants: string[];  // IDs dos usuários participantes
  lastMessage?: Message;
  timestamp: Timestamp;
}


