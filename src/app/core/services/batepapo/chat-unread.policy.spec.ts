import { describe, expect, it } from 'vitest';
import { isDirectMessageUnreadFor, totalDirectUnread } from './chat-unread.policy';
describe('canonical unread policy', () => {
  const count = (data: Record<string, unknown>) => isDirectMessageUnreadFor(data, 'me', 'peer');
  it.each(['sent', 'delivered'])('counts %s and valid legacy alias', status => {
    expect(count({ senderUid: 'peer', status })).toBe(true);
    expect(count({ senderId: 'peer', senderUid: 'peer', recipientUid: 'me', status })).toBe(true);
  });
  it.each([
    { senderId: 'peer', status: 'read' },
    { senderId: 'peer', status: 'sent', deleted: true },
    { senderId: 'me', status: 'sent' },
    { senderId: 'third', status: 'sent' },
    { senderId: 'peer', senderUid: 'me', status: 'sent' },
    { senderId: 'peer', recipientUid: 'third', status: 'sent' },
    { status: 'sent' },
  ])('excludes non-authorized or non-unread state %j', data => expect(count(data)).toBe(false));
  it('derives total from the exact same map', () => {
    expect(totalDirectUnread({ ownerUid: 'me', counts: new Map([['a', 3], ['b', 2]]) })).toBe(5);
  });
});
