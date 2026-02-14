// src/app/core/interfaces/interfaces-chat/room.interface.ts
import { Timestamp } from 'firebase/firestore';
import { Message } from './message.interface';

export interface IRoom {
  id: string;
  roomName: string;
  createdBy: string;
  participants: string[];
  creationTime: Timestamp | Date;
  description?: string;
  expirationDate?: Timestamp | Date;
  maxParticipants?: number;
  isPrivate?: boolean;
  roomType?: 'public' | 'private' | 'event';
  lastActivity?: Timestamp | Date;
  visibility?: 'public' | 'restricted' | 'hidden';

  // Para o sort no ChatList:
  lastMessage?: Message;
  isRoom?: true;                // discriminador opcional
}

// Dados apenas de confirmação de modal (não fazem parte de IRoom)
export interface RoomCreationConfirmation {
  exceededLimit: boolean;
  roomCount: number;
  action: 'created' | 'updated';
  room: IRoom;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
