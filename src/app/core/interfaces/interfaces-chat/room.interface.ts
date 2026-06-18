// src/app/core/interfaces/interfaces-chat/room.interface.ts
import { Timestamp } from 'firebase/firestore';
import { Message } from './message.interface';

export type RoomPlaceIntentMode = 'now' | 'scheduled';
export type RoomPlaceIntentVisibility = 'room_members' | 'regional_teaser';

/**
 * Intenção operacional de local da sala.
 *
 * Regras de privacidade:
 * - não armazena coordenada precisa;
 * - não armazena lista de usuários presentes;
 * - serve para rooms, sugestões e projeções agregadas regionais;
 * - a autorização final para preencher esse bloco é validada no backend.
 */
export interface IRoomPlaceIntent {
  mode: RoomPlaceIntentMode;
  visibility: RoomPlaceIntentVisibility;
  region: {
    uf: string;
    city: string;
  };
  label: string;
  startsAt: number;
  endsAt?: number | null;
  source: 'owner_declared';
  createdAt?: Timestamp | Date | number | null;
  updatedAt?: Timestamp | Date | number | null;
}

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
  placeIntent?: IRoomPlaceIntent | null;

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
