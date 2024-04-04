//src\app\core\interfaces\interfaces-chat\chat.interface.ts
import { Timestamp } from "@firebase/firestore";
import { Message } from "./message.interface";
import { IUserDados } from "../iuser-dados";
export interface Chat {
  id?: string;
  participants: string[];  // IDs dos usuários participantes
  participantsKey?: string;  // Chave única representando os participantes
  lastMessage?: Message;
  timestamp: Timestamp;
  otherParticipantDetails?: IUserDados | null;
  isRoom?: boolean;
  roomName?: string;
}


