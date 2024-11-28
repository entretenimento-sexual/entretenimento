// src/app/store/effects/effects.chat/room.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import * as RoomActions from '../../actions/actions.chat/room.actions';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { from, of } from 'rxjs';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

@Injectable()
export class RoomEffects {
  constructor(
    private actions$: Actions,
    private roomService: RoomService,
    private roomManagement: RoomManagementService
  ) { }

  // Effect para carregar as salas do usuário
  loadRooms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RoomActions.LoadRooms),
      mergeMap((action) => {
        const userId = action.userId;
        console.log('LoadRooms acionado');
        return this.roomService.getRooms(userId).pipe(
          map((rooms: Chat[]) => {
            console.log('LoadRoomsSuccess com salas:', rooms);
            return RoomActions.LoadRoomsSuccess({ rooms });
          }),
          catchError((error) => {
            console.error('Erro ao carregar salas:', error);
            return of(RoomActions.LoadRoomsFailure({ error }));
          })
        );
      })
    )
  );

  // Effect para criar uma sala
  createRoom$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RoomActions.CreateRoom),
      mergeMap(action => {
        console.log('CreateRoom acionado com detalhes:', action.roomDetails);
        return this.roomManagement.createRoom(action.roomDetails, action.roomDetails.creatorId).pipe(
          map((room: unknown) => {
            const validRoom = room as Chat; // Convertendo para o tipo Chat
            console.log('CreateRoomSuccess com sala:', validRoom);
            return RoomActions.CreateRoomSuccess({ room: validRoom });
          }),
          catchError(error => {
            console.error('Erro ao criar sala:', error);
            return of(RoomActions.CreateRoomFailure({ error }));
          })
        );
      })
    )
  );

  // Effect para deletar uma sala
  deleteRoom$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RoomActions.DeleteRoom),
      mergeMap(action => {
        console.log('DeleteRoom acionado para sala ID:', action.roomId);
        return from(this.roomManagement.deleteRoom(action.roomId)).pipe(
          map(() => {
            console.log('DeleteRoomSuccess para sala ID:', action.roomId);
            return RoomActions.DeleteRoomSuccess({ roomId: action.roomId });
          }),
          catchError(error => {
            console.error('Erro ao deletar sala:', error);
            return of(RoomActions.DeleteRoomFailure({ error }));
          })
        );
      })
    )
  );
}
