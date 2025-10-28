// src/app/store/selectors.location/nearby-profiles.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectNearbyProfilesState } from '../../reducers/reducers.location/nearby-profiles.reducer';
import { NearbyQueryParams, buildNearbyKey } from '../../states/states.location/nearby-profiles.state';

export const selectTtlMs = createSelector(
  selectNearbyProfilesState,
  s => s.ttlMs
);

export const selectEntryByKey = (key: string) => createSelector(
  selectNearbyProfilesState,
  s => s.byKey[key] || { list: [], loading: false, error: null, updatedAt: 0 }
);

export const selectIsFreshByKey = (key: string) => createSelector(
  selectEntryByKey(key),
  selectTtlMs,
  (_entry, ttl) => {
    const now = Date.now();
    return now - _entry.updatedAt < ttl;
  }
);

/** Factories por parâmetros (lat,lon,raio,uid) */
export const selectNearbyListByParams = (p: NearbyQueryParams) => {
  const key = buildNearbyKey(p);
  return createSelector(selectEntryByKey(key), e => e.list);
};

export const selectNearbyLoadingByParams = (p: NearbyQueryParams) => {
  const key = buildNearbyKey(p);
  return createSelector(selectEntryByKey(key), e => e.loading);
};

export const selectNearbyErrorByParams = (p: NearbyQueryParams) => {
  const key = buildNearbyKey(p);
  return createSelector(selectEntryByKey(key), e => e.error);
};

export const selectNearbyFreshByParams = (p: NearbyQueryParams) => {
  const key = buildNearbyKey(p);
  return selectIsFreshByKey(key);
};

export const selectNearbyVMByParams = (p: NearbyQueryParams) => {
  const key = buildNearbyKey(p);
  return createSelector(
    selectEntryByKey(key),
    selectTtlMs,
    (e, ttl) => {
      const age = Date.now() - (e.updatedAt || 0);
      return {
        key, list: e.list, loading: e.loading, error: e.error,
        updatedAt: e.updatedAt, isFresh: age < ttl, ttlMs: ttl, ttlLeftMs: Math.max(ttl - age, 0),
      };
    }
  );
};
