//src\app\store\actions\actions.interactions\actions.friends.ts
import { createAction, props } from '@ngrx/store';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { BlockedUser } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Load friends
export const loadFriends = createAction('[Friendship] Load Friends', props<{ uid: string }>());
export const loadFriendsSuccess = createAction('[Friendship] Load Friends Success', props<{ friends: Friend[] }>());
export const loadFriendsFailure = createAction('[Friendship] Load Friends Failure', props<{ error: string }>());

// Friend Requests
export const sendFriendRequest = createAction('[Friendship] Send Request', props<{ requesterUid: string; targetUid: string; message?: string }>());
export const sendFriendRequestSuccess = createAction('[Friendship] Send Request Success');
export const sendFriendRequestFailure = createAction('[Friendship] Send Request Failure', props<{ error: string }>());

export const loadInboundRequests = createAction('[Friendship] Load Inbound Requests', props<{ uid: string }>());
export const loadInboundRequestsSuccess = createAction('[Friendship] Load Inbound Requests Success', props<{ requests: (FriendRequest & { id: string })[] }>());
export const loadInboundRequestsFailure = createAction('[Friendship] Load Inbound Requests Failure', props<{ error: string }>());

export const acceptFriendRequest = createAction('[Friendship] Accept Request', props<{ requestId: string; requesterUid: string; targetUid: string }>());
export const acceptFriendRequestSuccess = createAction('[Friendship] Accept Request Success', props<{ requestId: string }>());
export const acceptFriendRequestFailure = createAction('[Friendship] Accept Request Failure', props<{ error: string }>());

export const declineFriendRequest = createAction('[Friendship] Decline Request', props<{ requestId: string }>());
export const declineFriendRequestSuccess = createAction('[Friendship] Decline Request Success', props<{ requestId: string }>());
export const declineFriendRequestFailure = createAction('[Friendship] Decline Request Failure', props<{ error: string }>());

// Block
export const blockUser = createAction('[Friendship] Block User', props<{ ownerUid: string; targetUid: string; reason?: string }>());
export const unblockUser = createAction('[Friendship] Unblock User', props<{ ownerUid: string; targetUid: string }>());
export const loadBlockedUsers = createAction('[Friendship] Load Blocked Users', props<{ uid: string }>());
export const loadBlockedUsersSuccess = createAction('[Friendship] Load Blocked Users Success', props<{ blocked: BlockedUser[] }>());

// 👇 RESET do status de envio (usado no reducer)
export const resetSendFriendRequestStatus = createAction(
  '[Friendship] Reset Send Friend Request Status'
);

// 👇 Ações de busca (usadas no FriendSearchComponent e no reducer)
export const loadSearchResults = createAction(
  '[Friendship] Load Search Results',
  props<{ searchTerm: string }>()
);

export const loadSearchResultsSuccess = createAction(
  '[Friendship] Load Search Results Success',
  props<{ results: IUserDados[] }>()
);

export const loadSearchResultsFailure = createAction(
  '[Friendship] Load Search Results Failure',
  props<{ error: string }>()
);

// 👇 Ação de settings (usada no FriendSettingsComponent e no reducer)
export const updateFriendSettings = createAction(
  '[Friendship] Update Friend Settings',
  props<{
    settings: {
      receiveRequests: boolean;
      showOnlineStatus: boolean;
      allowSearchByNickname: boolean;
    };
  }>()
);
