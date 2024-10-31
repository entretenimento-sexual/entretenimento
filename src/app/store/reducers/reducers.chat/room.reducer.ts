// src/app/store/reducers/reducers.chat/room.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialRoomState, RoomState } from '../../states/states.chat/room.state';
import * as RoomActions from '../../actions/actions.chat/room.actions';

export const roomReducer = createReducer<RoomState>(
  initialRoomState,

  // Carregar salas
  on(RoomActions.LoadRooms, (state) => ({
    ...state,
    loading: true,
    error: null
  })),
  on(RoomActions.LoadRoomsSuccess, (state, { rooms }) => ({
    ...state,
    rooms,
    loading: false
  })),
  on(RoomActions.LoadRoomsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  })),

  // Enviar mensagem na sala
  on(RoomActions.SendRoomMessage, (state, { roomId, message }) => ({
    ...state,
    rooms: state.rooms.map(room =>
      room.id === roomId ? { ...room, lastMessage: message } : room
    )
  })),

  // Criar nova sala
  on(RoomActions.CreateRoom, (state) => ({
    ...state,
    loading: true
  })),
  on(RoomActions.CreateRoomSuccess, (state, { room }) => ({
    ...state,
    rooms: [...state.rooms, room],
    loading: false
  }))
);
