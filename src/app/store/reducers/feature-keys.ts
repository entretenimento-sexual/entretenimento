// src/app/store/reducers/feature-keys.ts
// Centraliza as chaves de cada slice do Store.
// Mantém consistência entre reducers, selectors e AppState.
export const STORE_FEATURE = {
  // USER DOMAIN
  auth: 'auth',
  user: 'user',
  terms: 'terms',
  file: 'file',
  userPreferences: 'userPreferences',

  // CHAT DOMAIN
  chat: 'chat',
  invite: 'invite',
  room: 'room',

  // LOCATION DOMAIN
  location: 'location',
  nearbyProfiles: 'nearbyProfiles',

  // INTERACTIONS DOMAIN
  friendsPages: 'friendsPages',
  interactionsFriends: 'interactions_friends', // <- valor precisa bater com o AppState/selector

  // CACHE
  cache: 'cache',
} as const;

export type StoreFeatureKey = typeof STORE_FEATURE[keyof typeof STORE_FEATURE];
