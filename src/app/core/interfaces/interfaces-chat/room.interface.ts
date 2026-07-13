// src/app/core/interfaces/interfaces-chat/room.interface.ts
import { Timestamp } from 'firebase/firestore';
import { Message } from './message.interface';

export type RoomPlaceIntentMode = 'now' | 'scheduled';
export type RoomPlaceIntentVisibility = 'room_members' | 'regional_teaser';

/**
 * Snapshot canônico e temporário de um estabelecimento associado à sala.
 *
 * Segurança:
 * - o cliente envia somente venueId, modo e horário pretendido;
 * - nome, região, tipo, endereço aproximado, visibilidade e expiração são
 *   resolvidos pelo backend a partir do catálogo moderado de estabelecimentos;
 * - não armazena coordenada precisa nem lista pública de pessoas presentes.
 */
export interface IRoomPlaceIntent {
  venueId: string;
  mode: RoomPlaceIntentMode;
  visibility: RoomPlaceIntentVisibility;
  region: {
    uf: string;
    city: string;
  };
  label: string;
  venueKind?: string | null;
  addressHint?: string | null;
  startsAt: number;
  endsAt: number;
  source: 'venue_catalog';
  createdAt?: Timestamp | Date | number | null;
  updatedAt?: Timestamp | Date | number | null;
}

/**
 * Entrada mínima aceita pelo cliente. Os demais campos são autoridade do backend.
 */
export interface IRoomPlaceIntentInput {
  venueId: string;
  mode: RoomPlaceIntentMode;
  startsAt?: number | null;
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
  isRoom?: true;
}

// Dados apenas de confirmação de modal (não fazem parte de IRoom)
export interface RoomCreationConfirmation {
  exceededLimit: boolean;
  roomCount: number;
  action: 'created' | 'updated';
  room: IRoom;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
