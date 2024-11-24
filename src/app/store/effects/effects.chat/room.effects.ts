// src/app/store/effects/effects.chat/room.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import * as RoomActions from '../../actions/actions.chat/room.actions';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { from, of } from 'rxjs';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';

@Injectable()
export class RoomEffects {
  constructor(
    private actions$: Actions,
    private roomService: RoomService,
    private roomManagement: RoomManagementService
  ) { }

  loadRooms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RoomActions.LoadRooms),
      mergeMap(() => {
        console.log('LoadRooms acionado');
        return from(this.roomService.getRooms()).pipe(
          map(rooms => {
            console.log('LoadRoomsSuccess com salas:', rooms);
            return RoomActions.LoadRoomsSuccess({ rooms });
          }),
          catchError(error => {
            console.error('Erro ao carregar salas:', error);
            return of(RoomActions.LoadRoomsFailure({ error }));
          })
        );
      })
    )
  );

  createRoom$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RoomActions.CreateRoom),
      mergeMap(action => {
        console.log('CreateRoom acionado com detalhes:', action.roomDetails);
        return this.roomManagement.createRoom(action.roomDetails).pipe(
          map(room => {
            console.log('CreateRoomSuccess com sala:', room);
            return RoomActions.CreateRoomSuccess({ room });
          }),
          catchError(error => {
            console.error('Erro ao criar sala:', error);
            return of(RoomActions.CreateRoomFailure({ error }));
          })
        );
      })
    )
  );

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
