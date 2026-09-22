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
// -----------------------------------------------------------------------------

export const ROOM_COMPATIBILITY_SURFACE = Object.freeze({
  productState: 'deprecated_compatibility_only' as const,
  canonicalRoute: '/chat/rooms' as const,
  temporaryAliases: Object.freeze([
    '/dashboard/chat-rooms',
  ] as const),
  canonicalCollectiveDomain: 'community' as const,
  newFeaturesAllowed: false as const,
});
