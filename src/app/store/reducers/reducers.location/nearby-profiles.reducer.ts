// src/app/store/reducers/reducers.location/nearby-profiles.reducer.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import {
  NEARBY_PROFILES_FEATURE_KEY,
  buildNearbyKey,
  initialNearbyProfilesState,
} from '../../states/states.location/nearby-profiles.state';
import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';

export const nearbyProfilesFeature = createFeature({
  name: NEARBY_PROFILES_FEATURE_KEY,
  reducer: createReducer(
    initialNearbyProfilesState,

    on(NearbyProfilesActions.load, (state, { params }) => {
      /**
       * A mesma chave canônica deve ser usada pelo reducer, effect e selectors.
       * buildNearbyKey estabiliza pequenas oscilações do GPS e impede que o
       * loading seja gravado em uma entrada diferente daquela observada pela UI.
       */
      const key = buildNearbyKey(params);
      const prev = state.byKey[key] || {
        list: [],
        loading: false,
        error: null,
        updatedAt: 0,
      };

      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: { ...prev, loading: true, error: null },
        },
      };
    }),

    on(NearbyProfilesActions.loaded, (state, { key, list, updatedAt }) => ({
      ...state,
      byKey: {
        ...state.byKey,
        [key]: { list, loading: false, error: null, updatedAt },
      },
    })),

    on(NearbyProfilesActions.error, (state, { key, message }) => {
      const prev = state.byKey[key] || {
        list: [],
        loading: false,
        error: null,
        updatedAt: 0,
      };

      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: { ...prev, loading: false, error: message },
        },
      };
    }),

    on(NearbyProfilesActions.invalidate, (state, { key }) => {
      if (!key) {
        const byKey = Object.fromEntries(
          Object.entries(state.byKey).map(([entryKey, value]) => [
            entryKey,
            { ...value, updatedAt: 0 },
          ])
        );

        return { ...state, byKey };
      }

      const entry = state.byKey[key];
      if (!entry) return state;

      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: { ...entry, updatedAt: 0 },
        },
      };
    })
  ),
});

export const {
  name: nearbyProfilesFeatureKey,
  reducer: nearbyProfilesReducer,
  selectNearbyProfilesState,
} = nearbyProfilesFeature;
