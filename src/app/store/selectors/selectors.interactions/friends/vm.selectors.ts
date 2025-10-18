// src/app/store/selectors/selectors.interactions/friends/vm.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../../states/app.state';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

import { selectAllFriends } from './friends.selectors';
import { selectInboundRequests } from './inbound.selectors';
import { selectOutboundRequests } from './outbound.selectors';

const selectPresenceMap = (state: AppState) =>
  ((state as any)?.presence?.byUid ?? {}) as Record<string, boolean>;

export interface FriendVM {
  friendUid: string;
  nickname?: string;
  lastInteractionAt?: number;
  distanceKm?: number;
  isOnline?: boolean;
}

export const selectFriendsVM = createSelector(
  selectAllFriends,
  selectPresenceMap,
  (friends, presence): FriendVM[] =>
    friends.map((f: any) => {
      const uid = f.friendUid ?? f.uid;
      const fromPresence = !!presence[uid];
      const fromFriend = typeof f.isOnline === 'boolean' ? f.isOnline : undefined;
      return {
        friendUid: uid,
        nickname: f.nickname,
        lastInteractionAt: f.lastInteractionAt ?? 0,
        distanceKm: f.distanceKm,
        isOnline: fromFriend ?? fromPresence,
      };
    })
);

// Helpers para Inbound VM
const selectUsersMap = (state: AppState) =>
  ((state as any)?.user?.users ?? {}) as Record<string, any>;

const shorten = (uid?: string) => uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : '';
const getAvatar = (u?: any) => u?.photoURL || u?.avatarUrl || u?.imageUrl || undefined;

export type InboundRequestVM = (FriendRequest & { id: string }) & {
  nickname: string;
  avatarUrl?: string;
};

export const selectInboundRequestsVM = createSelector(
  selectInboundRequests,
  selectUsersMap,
  (reqs, users): InboundRequestVM[] =>
    (reqs ?? []).map((r: any) => {
      const u = users[r.requesterUid];
      const nickname = u?.nickname || u?.displayName || shorten(r.requesterUid);
      const avatarUrl = getAvatar(u);
      return { ...r, id: r.id!, nickname, avatarUrl };
    })
);

// Unificação de inbound + outbound
export type FriendRequestVM = (FriendRequest & { id: string }) & { direction: 'in' | 'out' };

export const selectAllRequestsVM = createSelector(
  selectInboundRequests,
  selectOutboundRequests,
  (inb, outb): FriendRequestVM[] => ([
    ...(inb ?? []).map(r => ({ ...(r as any), id: (r as any).id!, direction: 'in' as const })),
    ...(outb ?? []).map(r => ({ ...(r as any), id: (r as any).id!, direction: 'out' as const })),
  ])
);

export const selectAllRequestsCount = createSelector(
  selectInboundRequests, selectOutboundRequests,
  (a, b) => (a?.length ?? 0) + (b?.length ?? 0)
);
