// src/app/store/selectors/selectors.location/nearby-profiles.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { NearbyProfilesState } from 'src/app/store/states/states.location/nearby-profiles.state';

export const selectNearbyProfilesState = createFeatureSelector<NearbyProfilesState>('nearbyProfiles');

export const selectNearbyProfiles = createSelector(
  selectNearbyProfilesState,
  state => state.profiles
);

export const selectNearbyProfilesLoading = createSelector(
  selectNearbyProfilesState,
  state => state.loading
);

export const selectNearbyProfilesError = createSelector(
  selectNearbyProfilesState,
  state => state.error
);
