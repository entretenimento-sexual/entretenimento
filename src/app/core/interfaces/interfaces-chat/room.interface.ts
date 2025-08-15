// src/app/core/interfaces/interfaces-chat/room.interface.ts
import { Timestamp } from 'firebase/firestore';

export interface IRoom {
  id?: string;
  roomName: string;                 // Nome da sala
  createdBy: string;                // Criador
  participants: string[];           // IDs dos participantes
  creationTime: Timestamp | Date;   // Data de criação (use este nome no service)
  description?: string;
  expirationDate?: Timestamp | Date;
  maxParticipants?: number;
  isPrivate?: boolean;
  roomType?: 'public' | 'private' | 'event';
  lastActivity?: Timestamp | Date;
  visibility?: 'public' | 'restricted' | 'hidden';
}

// Continua separada: dados de confirmação (não fazem parte do doc)
export interface RoomCreationConfirmation {
  exceededLimit: boolean;
  roomCount: number;
  action: 'created' | 'updated';
}
