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
  updatedAt?: Timestamp;           // quando o chat foi atualizado pela última vez (opcional, mas recomendado)
  createdAt?: Timestamp;           // quando o chat foi criado (opcional, mas recomendado)
  lastMessageAt?: Timestamp;         // quando a última mensagem foi enviada (opcional, mas recomendado)
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
