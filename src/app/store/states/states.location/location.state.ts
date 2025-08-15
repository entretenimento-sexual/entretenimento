// src/app/store/states/states.location/location.state.ts
export interface LocationState {
  currentLocation: {
    latitude: number;
    longitude: number;
  } | null;

  searchParams: {
    maxDistanceKm: number;
  };
}

export const initialLocationState: LocationState = {
  currentLocation: null,
  searchParams: {
    maxDistanceKm: 10, // valor padrão
  }
};
