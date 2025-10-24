// src/app/store/selectors/selectors.interactions/friends/vm.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectAllFriends } from './friends.selectors';
import { selectPresenceMap } from './vm-selectors/vm.utils';

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
    (friends ?? []).map((f: any) => {
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
