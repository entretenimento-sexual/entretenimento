//src\app\store\reducers\reducers.location\location.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialLocationState, LocationState } from '../../states/states.location/location.state';
import { loadNearbyProfiles, loadNearbyProfilesSuccess, loadNearbyProfilesFailure, updateCurrentLocation } from '../../actions/actions.location/location.actions';

export const locationReducer = createReducer(
  initialLocationState,
  on(loadNearbyProfiles, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadNearbyProfilesSuccess, (state, { profiles }) => ({
    ...state,
    nearbyProfiles: profiles,
    loading: false,
    error: null,
  })),
  on(loadNearbyProfilesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(updateCurrentLocation, (state, { latitude, longitude }) => ({
    ...state,
    currentLocation: { latitude, longitude }
  }))
);
