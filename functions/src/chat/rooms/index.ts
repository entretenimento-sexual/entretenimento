// functions/src/chat/rooms/index.ts
// -----------------------------------------------------------------------------
// ROOMS DOMAIN EXPORTS
// -----------------------------------------------------------------------------
//
// Barrel do domínio de salas.
//
// Regra:
// - este arquivo exporta somente handlers públicos do domínio `rooms`;
// - o agregador do domínio de mensageria permanece em `functions/src/chat/index.ts`.
export { createPrivateRoom } from './application/create-private-room.handler';