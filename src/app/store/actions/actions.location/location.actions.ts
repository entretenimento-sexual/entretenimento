//src\app\store\actions\actions.location\location.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';

export const updateUserLocation = createAction(
  '[User] Update User Location',
  props<{ uid: string; location: GeoCoordinates }>()
);

export const loadNearbyProfiles = createAction(
  '[Location] Load Nearby Profiles',
  props<{ latitude: number; longitude: number; maxDistanceKm: number }>()
);

export const loadNearbyProfilesSuccess = createAction(
  '[Location] Load Nearby Profiles Success',
  props<{ profiles: IUserDados[] }>()
);

export const loadNearbyProfilesFailure = createAction(
  '[Location] Load Nearby Profiles Failure',
  props<{ error: string }>()
);

export const updateCurrentLocation = createAction(
  '[Location] Update Current Location',
  props<{ latitude: number; longitude: number }>()
);
