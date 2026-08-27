// functions/src/friendship/index.ts
// -----------------------------------------------------------------------------
// FRIENDSHIP DOMAIN EXPORTS
// -----------------------------------------------------------------------------
// Centraliza todas as Cloud Functions do domínio de amizade/conexões.
//
// Modelo de segurança:
// - o frontend Angular não deve escrever estado social sensível diretamente;
// - envio, aceite, cancelamento, recusa, desfazimento e bloqueio passam backend;
// - as Firestore Rules ficam como fronteira de leitura para estado privado;
// - o mesmo contrato serve web e futura expansão mobile.
// -----------------------------------------------------------------------------
export { sendFriendRequest } from './application/send-friend-request.handler';
export { acceptFriendRequest } from './application/accept-friend-request.handler';
export { cancelFriendRequest } from './application/cancel-friend-request.handler';
export { declineFriendRequest } from './application/decline-friend-request.handler';
export { endFriendship } from './application/end-friendship.handler';
export {
  blockUser,
  unblockUser,
} from './application/manage-user-block.handler';
