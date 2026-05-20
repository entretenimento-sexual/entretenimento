// src/app/core/interfaces/geolocation.interface.ts

/**
 * Coordenadas geográficas usadas pela plataforma.
 *
 * Observação:
 * - users/{uid} pode receber coordenada mais precisa;
 * - public_profiles/{uid} deve receber coordenada já tratada pela policy
 *   de privacidade do GeolocationService.
 */
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  geohash?: string;
}

/**
 * Estado padronizado da permissão de geolocalização.
 *
 * granted:
 * - o navegador já autorizou o uso da localização.
 *
 * prompt:
 * - o navegador ainda pode solicitar permissão ao usuário.
 *
 * denied:
 * - o usuário bloqueou a permissão de localização.
 *
 * unsupported:
 * - o navegador, ambiente ou API não permite consultar/usar essa permissão
 *   de forma confiável.
 */
export type GeoPermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported';

/**
 * Normaliza qualquer retorno do navegador/localStorage para o tipo único
 * usado na plataforma.
 *
 * Evita espalhar PermissionState, PermState ou strings soltas pelos componentes.
 */
export function normalizeGeoPermissionState(value: unknown): GeoPermissionState {
  if (value === 'granted') return 'granted';
  if (value === 'prompt') return 'prompt';
  if (value === 'denied') return 'denied';

  return 'unsupported';
}