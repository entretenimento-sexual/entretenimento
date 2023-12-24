// src\app\core\interfaces\geolocation.interface.ts
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  geohash?: string; // Adicione esta linha
}
