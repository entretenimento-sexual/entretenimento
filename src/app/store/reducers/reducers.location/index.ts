// src/app/store/reducers/reducers.location/index.ts
// Não esqueça os comentários
import { locationReducer } from './location.reducer';
import { nearbyProfilesReducer } from './nearby-profiles.reducer';

export const locationReducers = {
  location: locationReducer,
  nearbyProfiles: nearbyProfilesReducer,
};
