//src\app\core\interfaces\interfaces-chat\message.interface.tsmessage.interface.ts
import { Timestamp } from "@firebase/firestore";
export interface Message {
  id?: string;
  content: string;
  senderId: string; // ID do usuário remetente
  nickname: string; // Nickname do remetente
  timestamp: Timestamp;
}
