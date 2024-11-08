//src\app\store\selectors\selectors.location\location.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { LocationState } from '../../states/states.location/location.state';

export const selectLocationState = (state: AppState) => state.location;

export const selectNearbyProfiles = createSelector(
  selectLocationState,
  (state: LocationState) => state.nearbyProfiles
);

export const selectCurrentLocation = createSelector(
  selectLocationState,
  (state: LocationState) => state.currentLocation
);

export const selectLoading = createSelector(
  selectLocationState,
  (state: LocationState) => state.loading
);
