// src/app/store/states/states.chat/room.state.ts
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

export interface RoomState {
  rooms: Chat[];           // Lista de salas
  loading: boolean;        // Indicador de carregamento
  error: string | null;    // Mensagem de erro, se houver
}

export const initialRoomState: RoomState = {
  rooms: [],
  loading: false,
  error: null,
};
