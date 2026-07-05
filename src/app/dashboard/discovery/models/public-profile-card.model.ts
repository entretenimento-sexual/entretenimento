// src/app/dashboard/discovery/models/public-profile-card.model.ts
// -----------------------------------------------------------------------------
// PublicProfileCard
// -----------------------------------------------------------------------------
//
// Modelo visual mínimo para listagem de perfis públicos.
//
// Importante:
// - não representa o documento completo de users/{uid};
// - deve refletir apenas campos seguros de public_profiles;
// - não deve carregar e-mail, telefone, dados privados ou flags internas sensíveis;
// - métricas de mídia abaixo são agregadas canônicas públicas, vindas do backend.
export interface PublicProfileCard {
  uid: string;
  nickname: string;
  nicknameNormalized?: string | null;

  photoURL?: string | null;

  gender?: string | null;
  orientation?: string | null;

  /**
   * Campos canônicos calculados no backend por syncPublicProfileDiscovery.
   * Quando presentes, devem ter prioridade sobre os campos brutos acima.
   */
  normalizedGender?: string | null;
  normalizedOrientation?: string | null;
  compatibilityReady?: boolean | null;

  estado?: string | null;
  municipio?: string | null;

  role?: string | null;

  latitude?: number | null;
  longitude?: number | null;
  geohash?: string | null;

  distanciaKm?: number | null;
  isOnline?: boolean | null;
  lastOnlineAt?: unknown;
  lastOfflineAt?: unknown;
  lastSeen?: unknown;

  updatedAt?: unknown;
  createdAt?: unknown;
  compatibilityScore?: number | null;
  compatibilityReason?: string | null;
  preferences?: readonly string[] | string | null;
  interestedInGenders?: readonly string[] | string | null;
  interestedInOrientations?: readonly string[] | string | null;

  /**
   * Métricas públicas agregadas por refreshPublicProfileMediaMetrics().
   * Não devem ser recalculadas em componente visual.
   */
  mediaCount?: number | null;
  photosCount?: number | null;
  videosCount?: number | null;
  viewsCount?: number | null;
  likesCount?: number | null;
  engagementScore?: number | null;
  profileCompletenessScore?: number | null;
}
