//src\app\store\reducers\reducers.location\nearby-profiles.reducer.ts
import { createReducer, on } from '@ngrx/store';
import * as NearbyProfilesActions from 'src/app/store/actions/actions.location/nearby-profiles.actions';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface NearbyProfilesState {
  profiles: IUserDados[];
  loading: boolean;
  error: any;
}

export const initialState: NearbyProfilesState = {
  profiles: [],
  loading: false,
  error: null
};

export const nearbyProfilesReducer = createReducer(
  initialState,
  on(NearbyProfilesActions.loadNearbyProfiles, state => ({
    ...state,
    loading: true,
    error: null
  })),
  on(NearbyProfilesActions.loadNearbyProfilesSuccess, (state, { profiles }) => ({
    ...state,
    loading: false,
    profiles
  })),
  on(NearbyProfilesActions.loadNearbyProfilesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  }))
);
