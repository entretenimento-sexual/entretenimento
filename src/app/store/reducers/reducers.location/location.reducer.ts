//src\app\store\reducers\reducers.location\location.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialLocationState } from '../../states/states.location/location.state';
import { updateCurrentLocation } from 'src/app/store/actions/actions.location/location.actions';
import * as LocationActions from '../../actions/actions.location/location.actions';

export const locationReducer = createReducer(
  initialLocationState,
  on(updateCurrentLocation, (state, { latitude, longitude }) => ({
    ...state,
    currentLocation: { latitude, longitude }
  })),

   on(LocationActions.updateCurrentLocation, (state, { latitude, longitude }) => ({
     ...state,
     currentLocation: { latitude, longitude },
   })),

  on(LocationActions.setMaxDistance, (state, { maxDistanceKm }) => ({
    ...state,
    searchParams: { ...state.searchParams, maxDistanceKm }
  })),
);

