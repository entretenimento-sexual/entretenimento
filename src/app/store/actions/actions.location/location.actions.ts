//src\app\store\actions\actions.location\location.actions.ts
import { createAction, props } from '@ngrx/store';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';

export const updateUserLocation = createAction(
  '[User] Update User Location',
  props<{ uid: string; location: GeoCoordinates }>()
);

export const updateCurrentLocation = createAction(
  '[Location] Update Current Location',
  props<{ latitude: number; longitude: number }>()
);

//usada pelo componente para sincronizar o slider com o store
export const setMaxDistance = createAction(
  '[Location] Set Max Distance',
  props<{ maxDistanceKm: number }>()
);
