// functions/src/rooms/index.ts
// -----------------------------------------------------------------------------
// ROOMS DOMAIN EXPORTS
// -----------------------------------------------------------------------------
//
// Barrel do domínio de salas.
//
// Regra:
// - este arquivo exporta somente handlers públicos do domínio `rooms`;
// - o agregador global permanece em `functions/src/index.ts`.
export { createPrivateRoom } from './application/create-private-room.handler';