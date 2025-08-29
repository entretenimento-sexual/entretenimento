// src/app/store/effects/effects.chat/room.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import * as RoomActions from '../../actions/actions.chat/room.actions';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { from, of } from 'rxjs';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { environment } from '../../../../environments/environment';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';

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
      mergeMap((action) => {
        const userId = action.userId;
        if (!environment.production) {
          console.log('[RoomEffects] LoadRooms acionado para usuário ID:', userId);
        }
        return this.roomService.getRooms(userId).pipe(
          map((rooms: IRoom[]) => {
            if (!environment.production) {
              console.log('[RoomEffects] LoadRoomsSuccess com salas:', rooms);
            }
            return RoomActions.LoadRoomsSuccess({ rooms });
          }),
          catchError((error) => {
            if (!environment.production) {
              console.log('[RoomEffects] Erro ao carregar salas:', error);
            }
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
        if (!environment.production) {
          console.log('[RoomEffects] CreateRoom acionado com detalhes:', action.roomDetails);
        }
        return this.roomManagement.createRoom(action.roomDetails, action.roomDetails.creatorId).pipe(
          map((room: IRoom) => { // 👈 tipar como IRoom
            if (!environment.production) {
              console.log('[RoomEffects] CreateRoomSuccess com sala:', room);
            }
            return RoomActions.CreateRoomSuccess({ room }); // 👈 payload deve esperar IRoom
          }),
          catchError(error => {
            if (!environment.production) {
              console.log('[RoomEffects] Erro ao criar sala:', error);
            }
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
        if (!environment.production) {
          console.log('[RoomEffects] DeleteRoom acionado para sala ID:', action.roomId);
        }
        return from(this.roomManagement.deleteRoom(action.roomId)).pipe(
          map(() => {
            if (!environment.production) {
              console.log('[RoomEffects] DeleteRoomSuccess para sala ID:', action.roomId);
            }
            return RoomActions.DeleteRoomSuccess({ roomId: action.roomId });
          }),
          catchError(error => {
            if (!environment.production) {
              console.log('[RoomEffects] Erro ao deletar sala:', error);
            }
            return of(RoomActions.DeleteRoomFailure({ error }));
          })
        );
      })
    )
  );
}
