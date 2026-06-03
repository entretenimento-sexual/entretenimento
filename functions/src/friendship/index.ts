// functions/src/friendship/index.ts
// -----------------------------------------------------------------------------
// FRIENDSHIP DOMAIN EXPORTS
// -----------------------------------------------------------------------------
// Centraliza todas as Cloud Functions do domínio de amizade/conexões.
//
// Modelo de segurança:
// - o frontend Angular não deve escrever estado social sensível diretamente;
// - envio, aceite, cancelamento, recusa e desfazimento passam pelo backend;
// - as Firestore Rules poderão bloquear create/update/delete em friendRequests;
// - o mesmo contrato servirá para web e app mobile.
// -----------------------------------------------------------------------------
export { sendFriendRequest } from './application/send-friend-request.handler';
export { acceptFriendRequest } from './application/accept-friend-request.handler';
export { cancelFriendRequest } from './application/cancel-friend-request.handler';
export { declineFriendRequest } from './application/decline-friend-request.handler';
export { endFriendship } from './application/end-friendship.handler';