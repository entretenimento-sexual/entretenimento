// src/app/core/domain/room-compatibility.policy.ts
// -----------------------------------------------------------------------------
// ROOM COMPATIBILITY SURFACE
// -----------------------------------------------------------------------------
// Salas independentes são legado congelado. A única superfície navegável que
// permanece compatível é /chat/rooms, exclusivamente para consulta histórica e
// encerramento seguro. O alias /dashboard/chat-rooms existe apenas para links
// antigos e deve redirecionar sem montar componente próprio.
//
// Comunidades são o domínio canônico para novas interações coletivas.
//
// A remoção final não tem data programada: ela depende de evidência de que o
// legado deixou de ter uso relevante. Essa decisão deve reaproveitar as fontes
// já existentes (rooms, convites legados e room_audit), sem criar um novo
// domínio compartilhado Community/Room só para conduzir a aposentadoria.
// -----------------------------------------------------------------------------

export const ROOM_COMPATIBILITY_SURFACE = Object.freeze({
  productState: 'deprecated_compatibility_only' as const,
  canonicalRoute: '/chat/rooms' as const,
  temporaryAliases: Object.freeze([
    '/dashboard/chat-rooms',
  ] as const),
  canonicalCollectiveDomain: 'community' as const,
  newFeaturesAllowed: false as const,
  sharedDomainWithCommunityAllowed: false as const,
  removalPolicy: Object.freeze({
    strategy: 'residual_usage_evidence' as const,
    scheduledRemovalAt: null,
    requireNoRelevantResidualUsage: true as const,
    existingEvidenceSources: Object.freeze([
      'rooms',
      'invites',
      'room_audit',
    ] as const),
  }),
});
