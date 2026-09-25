// src/app/store/reducers/feature-keys.ts
// Centraliza as chaves de cada slice do Store.
// Mantém consistência entre reducers, selectors e AppState.
export const STORE_FEATURE = {
  // USER DOMAIN
  auth: 'auth',
  user: 'user',
  file: 'file',
  userPreferences: 'userPreferences',

  // LOCATION DOMAIN
  location: 'location',
  nearbyProfiles: 'nearbyProfiles',

  // DISCOVERY DOMAIN
  discoveryFeeds: 'discoveryFeeds',
  communityDiscoveryCache: 'communityDiscoveryCache',

  // INTERACTIONS DOMAIN
  friendsPages: 'friendsPages',
  interactionsFriends: 'interactions_friends',
} as const;

