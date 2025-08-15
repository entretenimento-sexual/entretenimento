// src/app/store/states/states.location/nearby-profiles.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface NearbyProfilesState {
  profiles: IUserDados[];
  loading: boolean;
  error: string | null;
}

export const initialNearbyProfilesState: NearbyProfilesState = {
  profiles: [],
  loading: false,
  error: null
};
