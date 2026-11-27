import type { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import * as A from '../../actions/actions.interactions/actions.friends';
import * as P from '../../actions/actions.interactions/friends/friends-pagination.actions';
import { friendsReducer } from './friends.reducer';
import { friendsPaginationReducer } from './friends-pagination.reducer';
import { initialState } from '../../states/states.interactions/friends.state';
import { emptyFriendsPageSlice, initialFriendsPaginationState } from '../../states/states.interactions/friends-pagination.state';

describe('Friendship end / proteção da geração no estado', () => {
  const endedThrough = { seconds: 100, nanoseconds: 123456000 };
  const old: Friend = { friendUid: 'peer', sinceVersion: { seconds: 100, nanoseconds: 123455000 } };
  const fresh: Friend = { friendUid: 'peer', sinceVersion: { seconds: 100, nanoseconds: 123457000 } };
  const mainAction = A.endFriendshipSuccess({ ownerUid:'owner', friendUid:'peer', endedThrough });
  const pageAction = P.removeFriendFromFriendsPage({ uid:'owner', friendUid:'peer', endedThrough });
  it('remove relação antiga mas não apaga nova geração já recebida', () => {
    expect(friendsReducer({ ...initialState, friends: [old] },mainAction).friends).toEqual([]);
    expect(friendsReducer({ ...initialState, friends: [fresh] },mainAction).friends).toEqual([fresh]);
    const oldPage = { byUid: { owner: { ...emptyFriendsPageSlice, items: [old] } } };
    const newPage = { byUid: { owner: { ...emptyFriendsPageSlice, items: [fresh] } } };
    expect(friendsPaginationReducer(oldPage,pageAction).byUid['owner'].items).toEqual([]);
    expect(friendsPaginationReducer(newPage,pageAction).byUid['owner'].items).toEqual([fresh]);
  });
  it('não cria estado para uma rota fechada', () => {
    expect(friendsPaginationReducer(initialFriendsPaginationState,pageAction)).toBe(initialFriendsPaginationState);
  });
});
