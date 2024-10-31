// src/app/store/actions/actions.chat/room.actions.ts
import { createAction, props } from '@ngrx/store';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

// Ações para carregar salas
export const LoadRooms = createAction('[Room] Load Rooms');
export const LoadRoomsSuccess = createAction(
  '[Room] Load Rooms Success',
  props<{ rooms: Chat[] }>()
);
export const LoadRoomsFailure = createAction(
  '[Room] Load Rooms Failure',
  props<{ error: string }>()
);

// Ações para criar sala
export const CreateRoom = createAction(
  '[Room] Create Room',
  props<{ roomDetails: any }>()
);
export const CreateRoomSuccess = createAction(
  '[Room] Create Room Success',
  props<{ room: Chat }>()
);
export const CreateRoomFailure = createAction(
  '[Room] Create Room Failure',
  props<{ error: string }>()
);

// Ações para deletar sala
export const DeleteRoom = createAction(
  '[Room] Delete Room',
  props<{ roomId: string }>()
);
export const DeleteRoomSuccess = createAction(
  '[Room] Delete Room Success',
  props<{ roomId: string }>()
);
export const DeleteRoomFailure = createAction(
  '[Room] Delete Room Failure',
  props<{ error: string }>()
);

// Ação para enviar mensagem na sala
export const SendRoomMessage = createAction(
  '[Room] Send Room Message',
  props<{ roomId: string; message: Message }>()
);
console.log('SendRoomMessage action criada:', SendRoomMessage);

export const SendRoomMessageSuccess = createAction(
  '[Room] Send Room Message Success',
  props<{ message: Message }>()
);
console.log('SendRoomMessageSuccess action criada:', SendRoomMessageSuccess);

export const SendRoomMessageFailure = createAction(
  '[Room] Send Room Message Failure',
  props<{ error: string }>()
);
console.log('SendRoomMessageFailure action criada:', SendRoomMessageFailure);
