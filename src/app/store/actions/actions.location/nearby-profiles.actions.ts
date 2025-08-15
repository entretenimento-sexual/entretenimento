//src\app\store\actions\actions.location\nearby-profiles.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const loadNearbyProfiles = createAction(
  '[Location] Load Nearby Profiles',
  props<{ latitude: number; longitude: number; maxDistanceKm: number; userUid: string }>()
);

export const loadNearbyProfilesSuccess = createAction(
  '[Location] Load Nearby Profiles Success',
  props<{ profiles: IUserDados[] }>()
);

export const loadNearbyProfilesFailure = createAction(
  '[Location] Load Nearby Profiles Failure',
  props<{ error: any }>()
);
