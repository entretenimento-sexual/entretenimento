//src\app\core\interfaces\interfaces-chat\chat.interface.ts
import { Timestamp } from 'firebase/firestore';
import { Message } from './message.interface';
import { IUserDados } from '../iuser-dados';

export interface IChat {
  id?: string;
  participants: string[];
  participantsKey?: string;
  lastMessage?: Message;        // último msg do chat 1:1
  timestamp: Timestamp;         // quando o chat foi criado (se você usa)
  otherParticipantDetails?: IUserDados | null;
  isRoom?: false;               // ajuda em type-narrowing (discriminador opcional)
  roomName?: never;             // evita engano em IChat
}
