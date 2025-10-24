//src\app\store\actions\actions.interactions\friends\friends-realtime.actions.ts
import { createAction, props } from '@ngrx/store';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

// -----------------------------
// Realtime (inbound requests)
// -----------------------------
export const startInboundRequestsListener = createAction(
  '[Friendship] Start Inbound Requests Listener',
  props<{ uid: string }>()
);

export const stopInboundRequestsListener = createAction(
  '[Friendship] Stop Inbound Requests Listener'
);

export const inboundRequestsChanged = createAction(
  '[Friendship] Inbound Requests Changed',
  props<{ requests: (FriendRequest & { id: string })[] }>()
);

// ✅ Outbound (NOVO)
export const startOutboundRequestsListener = createAction(
  '[Friendship] Start Outbound Requests Listener',
  props<{ uid: string }>()
);
export const stopOutboundRequestsListener = createAction(
  '[Friendship] Stop Outbound Requests Listener'
);
export const outboundRequestsChanged = createAction(
  '[Friendship] Outbound Requests Changed',
  props<{ requests: (FriendRequest & { id: string })[] }>()
);
