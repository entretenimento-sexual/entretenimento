// src/app/store/reducers/reducers.location/nearby-profiles.reducer.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { NEARBY_PROFILES_FEATURE_KEY, initialNearbyProfilesState } from '../../states/states.location/nearby-profiles.state';
import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';

export const nearbyProfilesFeature = createFeature({
  name: NEARBY_PROFILES_FEATURE_KEY,
  reducer: createReducer(
    initialNearbyProfilesState,

    on(NearbyProfilesActions.load, (state, { params }) => {
      const key = `${params.uid}:${params.lat},${params.lon}:${params.radiusKm}`;
      const prev = state.byKey[key] || { list: [], loading: false, error: null, updatedAt: 0 };
      return {
        ...state,
        byKey: { ...state.byKey, [key]: { ...prev, loading: true, error: null } },
      };
    }),

    on(NearbyProfilesActions.loaded, (state, { key, list, updatedAt }) => ({
      ...state,
      byKey: { ...state.byKey, [key]: { list, loading: false, error: null, updatedAt } },
    })),

    on(NearbyProfilesActions.error, (state, { key, message }) => {
      const prev = state.byKey[key] || { list: [], loading: false, error: null, updatedAt: 0 };
      return {
        ...state,
        byKey: { ...state.byKey, [key]: { ...prev, loading: false, error: message } },
      };
    }),

    on(NearbyProfilesActions.invalidate, (state, { key }) => {
      if (!key) {
        const byKey = Object.fromEntries(
          Object.entries(state.byKey).map(([k, v]) => [k, { ...v, updatedAt: 0 }]),
        );
        return { ...state, byKey };
      }
      const entry = state.byKey[key];
      if (!entry) return state;
      return { ...state, byKey: { ...state.byKey, [key]: { ...entry, updatedAt: 0 } } };
    }),
  ),
});

export const {
  name: nearbyProfilesFeatureKey,
  reducer: nearbyProfilesReducer,
  selectNearbyProfilesState,
} = nearbyProfilesFeature;
