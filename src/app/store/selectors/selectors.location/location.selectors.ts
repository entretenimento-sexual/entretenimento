// src/app/store/selectors/selectors.location/location.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LocationState } from '../../states/states.location/location.state';

// 👇 casa com StoreModule.forFeature('location', locationReducer)
export const selectLocationState = createFeatureSelector<LocationState>('location');

// --- campos existentes no LocationState ---
export const selectCurrentLocation = createSelector(
  selectLocationState,
  (state) => state.currentLocation
);

export const selectSearchParams = createSelector(
  selectLocationState,
  (state) => state.searchParams
);

export const selectMaxDistanceKm = createSelector(
  selectSearchParams,
  (params) => params.maxDistanceKm
);

// QoL / debug
export const selectHasLocation = createSelector(
  selectCurrentLocation,
  (loc) => !!loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
);

// (Opcional) selector “raw” para debug rápido:
export const selectLocationRaw = createSelector(
  selectLocationState,
  (state) => state
);

/* **********************************************************************
 * VM SELECTOR – combina Location + NearbyProfiles (cache/TTL/list/loading)
 * ----------------------------------------------------------------------
 * Use quando quiser tudo pronto pro template: estado de localização + lista
 * de perfis, status de cache e TTL restante — para um UID específico.
 ***********************************************************************/

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectNearbyProfilesState } from '../../reducers/reducers.location/nearby-profiles.reducer';
import { buildNearbyKey } from '../../states/states.location/nearby-profiles.state';

// ✅ Definimos o TTL localmente (evita import com path errado e tipo unknown)
const selectNearbyTtlMs = createSelector(
  selectNearbyProfilesState,
  (s) => s.ttlMs as number
);

export interface LocationNearbyVM {
  key: string | null;
  currentLocation: { latitude: number; longitude: number } | null;
  maxDistanceKm: number;
  list: IUserDados[];
  loading: boolean;
  error: string | null;
  isFresh: boolean;
  ttlMs: number;
  ttlLeftMs: number;
}

/**
 * Factory de selector: passe o UID do usuário logado.
 * Exemplo de uso:
 *   this.vm$ = this.store.select(selectLocationNearbyVMByUid(userUid));
 */
export const selectLocationNearbyVMByUid = (uid: string) =>
  createSelector(
    selectCurrentLocation,
    selectMaxDistanceKm,
    selectNearbyProfilesState, // slice bruto (para pegar entry por key)
    selectNearbyTtlMs,         // TTL global (tipado como number)
    (currentLocation, maxDistanceKm, nearbyState, ttl: number): LocationNearbyVM => {
      // Caso não tenha localização ou UID, retorna VM "vazia"
      if (!uid || !currentLocation?.latitude || !currentLocation?.longitude) {
        return {
          key: null,
          currentLocation,
          maxDistanceKm,
          list: [],
          loading: false,
          error: null,
          isFresh: false,
          ttlMs: ttl,
          ttlLeftMs: 0,
        };
      }

      const params = {
        uid,
        lat: currentLocation.latitude,
        lon: currentLocation.longitude,
        radiusKm: maxDistanceKm,
      };
      const key = buildNearbyKey(params);
      const entry = nearbyState.byKey[key] || { list: [], loading: false, error: null, updatedAt: 0 };

      const age = Date.now() - (entry.updatedAt || 0);
      const isFresh = age < ttl;
      const ttlLeftMs = Math.max(ttl - age, 0);

      return {
        key,
        currentLocation,
        maxDistanceKm,
        list: entry.list,
        loading: entry.loading,
        error: entry.error,
        isFresh,
        ttlMs: ttl,
        ttlLeftMs,
      };
    }
  );
