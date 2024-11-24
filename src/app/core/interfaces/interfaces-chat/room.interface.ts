//src\app\core\interfaces\room-creation-confirmation-data.interface.ts
import { Timestamp } from '@firebase/firestore';

export interface IRoom {
  roomName: string;// Nome da sala
  exceededLimit: boolean;
  roomCount: number;
  action: 'created' | 'updated';
  id?: string; // ID da sala
  createdBy: string; // Criador da sala
  creationTime: Timestamp; // Data de criação
  description?: string; // Descrição da sala
  expirationDate?: Timestamp; // Data de expiração
  participants?: string[]; // IDs dos participantes
  maxParticipants?: number; // Limite máximo de participantes
  isPrivate?: boolean; // Sala privada ou pública
  roomType?: 'public' | 'private' | 'event'; // Tipo da sala
  lastActivity?: Timestamp; // Última atividade
  visibility?: 'public' | 'restricted' | 'hidden'; // Visibilidade da sala
}
