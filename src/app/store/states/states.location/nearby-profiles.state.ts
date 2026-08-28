// src/app/store/states.location/nearby-profiles.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const NEARBY_PROFILES_FEATURE_KEY = 'nearbyProfiles';

export interface NearbyQueryParams {
  lat: number;
  lon: number;
  radiusKm: number;
  uid: string;
}

export interface NearbyEntry {
  list: IUserDados[];
  loading: boolean;
  error: string | null;
  updatedAt: number; // epoch ms
}

export interface NearbyProfilesState {
  byKey: Record<string, NearbyEntry>;
  ttlMs: number;
}

export const initialNearbyProfilesState: NearbyProfilesState = {
  byKey: {},
  ttlMs: 120_000, // 2 minutos (ajuste à vontade)
};

/** Arredonda para dar estabilidade de cache (≈ 100–120m). */
export function roundCoord(n: number, precision = 3): number {
  const p = Math.pow(10, precision);
  return Math.round(n * p) / p;
}

/** Gera uma chave estável por consulta. */
export function buildNearbyKey(p: NearbyQueryParams): string {
  const lat = roundCoord(p.lat, 3);
  const lon = roundCoord(p.lon, 3);
  const r = Math.round(p.radiusKm); // resol. inteira p/ raio
  return `${p.uid}:${lat},${lon}:${r}`;
}
