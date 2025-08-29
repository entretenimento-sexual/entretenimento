// src/app/store/states/states.chat/room.state.ts
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';

export interface RoomState {
  rooms: IRoom[];              // Lista de salas
  loading: boolean;        // Indicador de carregamento
  error: string | null;    // Mensagem de erro, se houver
}

export const initialRoomState: RoomState = {
  rooms: [],
  loading: false,
  error: null,
};
