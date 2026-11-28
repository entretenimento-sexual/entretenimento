import type { Friend, FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';
import * as P from '../../actions/actions.interactions/friends/friends-pagination.actions';
import { friendsPaginationReducer } from './friends-pagination.reducer';
import { initialFriendsPaginationState } from '../../states/states.interactions/friends-pagination.state';

describe('Friends pagination / revisão canônica da cauda', () => {
  const uid = 'owner';
  const first: Friend[] = [{ friendUid:'a' },{ friendUid:'b' }];
  const tail: Friend[] = [{ friendUid:'c' },{ friendUid:'d' }];
  const cursor: FriendsPageCursor = { seconds:1,nanoseconds:7,documentId:'b' };
  const tailCursor: FriendsPageCursor = { seconds:1,nanoseconds:7,documentId:'d' };
  const revision = (confirmed: boolean) => P.invalidateFriendsTail({uid,confirmed});
  const success = (items: Friend[],nextOrderValue: FriendsPageCursor,append: boolean,reachedEnd: boolean) =>
    P.loadFriendsPageSuccess({uid,items,nextOrderValue,append,reachedEnd});
  function populated() {
    const init=friendsPaginationReducer(initialFriendsPaginationState,P.loadFriendsFirstPage({uid}));
    const confirmed=friendsPaginationReducer(init,revision(true));
    const firstPage=friendsPaginationReducer(confirmed,success(first,cursor,false,false));
    return friendsPaginationReducer(firstPage,success(tail,tailCursor,true,true));
  }
  it('descarta a cauda, recupera cursor bruto e mantém primeira página ao mudar revisão', () => {
    const previous=populated();
    const state=friendsPaginationReducer(previous,revision(true));
    const slice=state.byUid[uid];
    expect(slice.items).toEqual(first);
    expect(slice.items).toBe(previous.byUid[uid].firstPage?.items);
    expect(slice.nextOrderValue).toEqual(cursor);
    expect(slice.reachedEnd).toBe(false);
    expect(slice.loading).toBe(false);
    const updated=friendsPaginationReducer(state,success([tail[1]],tailCursor,true,true));
    expect(updated.byUid[uid].items).toEqual([...first,tail[1]]);
  });
  it('não admite append quando a revisão perdeu confirmação, mesmo com resposta tardia', () => {
    const state=friendsPaginationReducer(populated(),revision(false));
    expect(state.byUid[uid].items).toEqual(first);
    expect(friendsPaginationReducer(state,P.loadFriendsNextPage({uid}))).toBe(state);
    expect(friendsPaginationReducer(state,success(tail,tailCursor,true,true))).toBe(state);
    const recovered=friendsPaginationReducer(state,revision(true));
    expect(recovered.byUid[uid].tailConfirmed).toBe(true);
    expect(recovered.byUid[uid].nextOrderValue).toEqual(cursor);
  });
  it('não reintroduz uma remoção local ao restaurar primeira página', () => {
    const removed=friendsPaginationReducer(populated(),P.removeFriendFromFriendsPage({uid,friendUid:'a'}));
    const state=friendsPaginationReducer(removed,revision(true));
    expect(state.byUid[uid].items).toEqual([first[1]]);
  });
  it('não materializa slice após reset da rota', () => {
    const state=friendsPaginationReducer(populated(),P.resetFriendsPagination({uid}));
    expect(friendsPaginationReducer(state,revision(true))).toBe(state);
    expect(friendsPaginationReducer(state,success(tail,tailCursor,true,true))).toBe(state);
  });
});
