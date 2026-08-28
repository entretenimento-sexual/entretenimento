// src/app/core/services/geolocation/utils/geolocation-coordinate.utils.ts
// -----------------------------------------------------------------------------
// GeolocationCoordinateUtils
// -----------------------------------------------------------------------------
//
// Funções puras para validação e normalização de coordenadas.
//
// Motivo:
// - centralizar validação de latitude/longitude;
// - evitar duplicação entre DistanceCalculationService,
//   GeolocationTrackingService, NearbyProfilesService e componentes de discovery;
// - manter regra geográfica no domínio técnico de geolocalização;
// - não criar service Angular desnecessário para lógica pura.
export interface SafeGeoCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Converte number ou string numérica em número finito.
 */
export function toFiniteCoordinate(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;

  return Number.isFinite(n) ? n : null;
}

/**
 * Valida par latitude/longitude dentro dos limites geográficos reais.
 */
export function isValidGeoCoordinatePair(
  latitude: unknown,
  longitude: unknown
): boolean {
  const lat = toFiniteCoordinate(latitude);
  const lng = toFiniteCoordinate(longitude);

  return (
    lat !== null &&
    lng !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Extrai coordenadas válidas de qualquer objeto com latitude/longitude.
 */
export function extractValidGeoCoordinates(
  value: unknown
): SafeGeoCoordinates | null {
  const source = value as {
    latitude?: unknown;
    longitude?: unknown;
  } | null | undefined;

  const latitude = toFiniteCoordinate(source?.latitude);
  const longitude = toFiniteCoordinate(source?.longitude);

  if (!isValidGeoCoordinatePair(latitude, longitude)) {
    return null;
  }

  return {
    latitude: latitude as number,
    longitude: longitude as number,
  };
}