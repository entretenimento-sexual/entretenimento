// functions/src/chat/rooms/index.ts
// Barrel público das Cloud Functions do domínio de salas.
export { createPrivateRoom } from './application/create-private-room.handler';
export { closePrivateRoom } from './application/close-private-room.handler';
export {
  acceptRoomInvite,
  declineRoomInvite,
} from './application/respond-room-invite.handler';
