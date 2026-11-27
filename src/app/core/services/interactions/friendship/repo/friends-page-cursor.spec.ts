import { Timestamp } from 'firebase/firestore';
import { createFriendsPageCursor, friendsPageStartAfter } from './friends-page-cursor';

describe('FriendsPageCursor', () => {
  it('preserva nanossegundos e identificador do último documento bruto', () => {
    const stamp = new Timestamp(1700000000, 123456789);
    const cursor = createFriendsPageCursor('friend-24', stamp);
    expect(JSON.parse(JSON.stringify(cursor))).toEqual({
      seconds: 1700000000, nanoseconds: 123456789, documentId: 'friend-24',
    });
    const [restored, documentId] = friendsPageStartAfter(cursor);
    expect(restored.isEqual(stamp)).toBe(true);
    expect(documentId).toBe('friend-24');
  });

  it('distingue arestas empatadas no mesmo timestamp e no mesmo milissegundo', () => {
    const stamp = new Timestamp(1700000000, 123456000);
    const a = createFriendsPageCursor('a', stamp);
    const b = createFriendsPageCursor('b', stamp);
    const c = createFriendsPageCursor('c', new Timestamp(stamp.seconds, stamp.nanoseconds + 1));
    expect(a).not.toEqual(b);
    expect(friendsPageStartAfter(c)[0].isEqual(stamp)).toBe(false);
  });

  it('não substitui campos ausentes por um cursor fabricado', () => {
    expect(() => createFriendsPageCursor('a', undefined)).toThrow();
    expect(() => createFriendsPageCursor('', new Timestamp(1, 0))).toThrow();
  });
});
