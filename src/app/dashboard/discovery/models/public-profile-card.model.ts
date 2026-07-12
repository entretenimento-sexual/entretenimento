// src/app/dashboard/discovery/models/public-profile-card.model.ts
// -----------------------------------------------------------------------------
// PublicProfileCard
// -----------------------------------------------------------------------------
//
// Modelo público e serializável usado por discovery.
//
// Importante:
// - não representa o documento privado users/{uid};
// - deve refletir apenas campos seguros de public_profiles;
// - não deve carregar e-mail, telefone, identidade civil ou flags privadas;
// - datas destinadas ao NgRx devem chegar normalizadas em epoch (number);
// - métricas são agregadas canônicas produzidas pelo backend.
// -----------------------------------------------------------------------------

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

  partner1Orientation?: string | null;
  partner2Orientation?: string | null;

  preferences?: readonly string[] | string | null;
  interestedInGenders?: readonly string[] | string | null;
  interestedInOrientations?: readonly string[] | string | null;

  estado?: string | null;
  municipio?: string | null;

  role?: string | null;

  latitude?: number | null;
  longitude?: number | null;
  geohash?: string | null;

  distanciaKm?: number | null;
  isOnline?: boolean | null;
  lastOnlineAt?: number | null;
  lastOfflineAt?: number | null;
  lastSeen?: number | null;

  updatedAt?: number | null;
  createdAt?: number | null;

  compatibilityScore?: number | null;
  compatibilityReason?: string | null;

  /**
   * Métricas públicas agregadas por refreshPublicProfileMediaMetrics().
   * Não devem ser recalculadas em componente visual.
   */
  mediaCount?: number | null;
  photosCount?: number | null;
  videosCount?: number | null;
  viewsCount?: number | null;

  /** Pessoas distintas que visualizaram qualquer mídia deste perfil. */
  profileUniqueViewersCount?: number | null;

  /** Alias público compatível de profileUniqueViewersCount. */
  uniqueViewersCount?: number | null;

  /**
   * Soma técnica dos espectadores únicos de cada mídia.
   * A mesma pessoa pode aparecer mais de uma vez quando vê mídias diferentes.
   */
  mediaUniqueViewersCount?: number | null;

  likesCount?: number | null;
  reactionsCount?: number | null;
  viewScore?: number | null;
  engagementScore?: number | null;
  profileCompletenessScore?: number | null;
  mediaMetricsUpdatedAt?: number | null;
}
