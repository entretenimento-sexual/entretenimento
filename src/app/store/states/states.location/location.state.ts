//src\app\store\states\states.location\location.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface LocationState {
  currentLocation: {
    latitude: number;
    longitude: number;
  } | null;
  nearbyProfiles: IUserDados[];
  searchParams: {
    maxDistanceKm: number;
  };
  loading: boolean;
  error: string | null;
}

export const initialLocationState: LocationState = {
  currentLocation: null,
  nearbyProfiles: [],
  searchParams: {
    maxDistanceKm: 10, // valor padrão, pode ser alterado
  },
  loading: false,
  error: null,
};
