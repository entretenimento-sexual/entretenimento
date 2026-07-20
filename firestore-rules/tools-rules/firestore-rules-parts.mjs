// firestore-rules/tools-rules/firestore-rules-parts.mjs
// -----------------------------------------------------------------------------
// Manifesto canônico dos fragments usados para gerar e verificar firestore.rules.
//
// Build e checker devem importar esta mesma lista. Isso impede que um fragment
// entre no arquivo final sem participar da validação estrutural.
// -----------------------------------------------------------------------------

export const FIRESTORE_RULE_PARTS = Object.freeze([
  '_helpers.rules',

  // Documentos privados e domínios internos sensíveis.
  'users.rules',
  'billing.rules',
  'exclusive_connection_candidates.rules',

  // Discovery, presença e vitrines regionais moderadas.
  'public_profiles_next.rules',
  'public_profiles_photos.rules',
  'public_profiles_videos.rules',
  'presence.rules',
  'user_intent_statuses.rules',
  'venues.rules',
  'regional_hot_places.rules',

  // Relações, comunicação e notificações.
  'friendRequests.rules',
  'friends_root.rules',
  'chats.rules',
  'rooms.rules',
  'rooms_participants.rules',
  'public_index.rules',
  'notifications.rules',

  // Dados privados/públicos complementares de perfil.
  'users_profile_socialLinks.rules',
  'public_social_links.rules',
  'preferences.rules',
  'users_friends.rules',
  'user_profile.rules',
  'users_photos.rules',
  'users_videos.rules',
  'users_photo_publications.rules',
  'users_video_publications.rules',
  'users_blocks.rules',

  // Moderação e auditoria operacional.
  'moderation_reports.rules',

  // Demais módulos.
  'communities.rules',
  'invites.rules',
  'admin_logs.rules',

  '_footer.rules',
]);
