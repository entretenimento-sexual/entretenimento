// src/app/store/selectors/selectors.interactions/friend.selector.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { FriendsState, initialState } from '../../states/states.interactions/friends.state'; // ✅ do states
import { AppState } from '../../states/app.state';

/** ✅ Feature key deve bater com StoreModule.forFeature */
export const selectFriendsState =
  createFeatureSelector<FriendsState>('interactions_friends');

/** 🔒 Guard leve para evitar crash em dev se a feature ainda não montou (evita TypeError) */
const selectFriendsStateSafe = createSelector(
  (state: AppState) => state as any,
  (state) => (state?.['interactions_friends'] as FriendsState) ?? initialState
);

/** 🔄 Amigos */
export const selectFriends = createSelector(
  selectFriendsStateSafe,
  (s) => s.friends
);

export const selectAllFriends = createSelector(
  selectFriends,
  (friends) => Array.isArray(friends) ? friends : []
);

export const selectFriendsCount = createSelector(
  selectAllFriends,
  (friends) => friends.length
);

/** 📩 Solicitações (seu reducer salva em "requests") */
export const selectFriendRequests = createSelector(
  selectFriendsStateSafe,
  (s) => s.requests
);

export const selectPendingFriendRequestsCount = createSelector(
  selectFriendRequests,
  (req) => req?.length ?? 0
);

/** 🚫 Bloqueados */
export const selectBlockedFriends = createSelector(
  selectFriendsStateSafe,
  (s) => s.blocked
);

export const selectBlockedFriendsCount = createSelector(
  selectBlockedFriends,
  (blocked) => blocked.length
);

/** ⏳ Loading + ❌ Error — use os nomes reais do seu reducer: "loading" e "loadingRequests" */
export const selectFriendsLoading = createSelector(
  selectFriendsStateSafe,
  (s) => s.loading
);

export const selectRequestsLoading = createSelector(
  selectFriendsStateSafe,
  (s) => s.loadingRequests
);

export const selectFriendsError = createSelector(
  selectFriendsStateSafe,
  (s) => s.error ?? null
);

export const selectIsSendingFriendRequest = createSelector(
  selectFriendsStateSafe,
  (s) => s.sendingFriendRequest
);

export const selectSendFriendRequestError = createSelector(
  selectFriendsStateSafe,
  (s) => s.sendFriendRequestError
);

export const selectSendFriendRequestSuccess = createSelector(
  selectFriendsStateSafe,
  (s) => s.sendFriendRequestSuccess
);

/** 👀 View Model (online/distância/etc.) */
export interface FriendVM {
  friendUid: string;
  nickname?: string;
  lastInteractionAt?: number;
  distanceKm?: number;
  isOnline?: boolean;
}

// "presence" é opcional; se não existir, não quebra
const selectPresenceMap = (state: AppState) =>
  ((state as any)?.presence?.byUid ?? {}) as Record<string, boolean>;

export const selectFriendsVM = createSelector(
  selectAllFriends,
  selectPresenceMap, // continua igual
  (friends, presence): FriendVM[] =>
    friends.map((f: any) => {
      const uid = f.friendUid ?? f.uid; // ✅ robusto a ambos
      const fromPresence = !!presence[uid];
      const fromFriend = typeof f.isOnline === 'boolean' ? f.isOnline : undefined;

      return {
        friendUid: uid,
        nickname: f.nickname,
        lastInteractionAt: f.lastInteractionAt ?? 0,
        distanceKm: f.distanceKm,
        isOnline: fromFriend ?? fromPresence,   // ✅ PRIORIDADE: Friend.isOnline
      };
    })
);
