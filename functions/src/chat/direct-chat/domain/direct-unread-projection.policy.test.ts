import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyDirectUnreadTransition,
  isDirectMessageUnread,
  type DirectUnreadMessage,
} from './direct-unread-projection.policy';

const message = (status: 'sent' | 'delivered' | 'read', deleted = false): DirectUnreadMessage => ({
  messageId: 'm1', senderUid: 'sender', status, deleted,
});

describe('direct unread projection policy (inactive contract)', () => {
  it('counts only messages received and not yet read', () => {
    assert.equal(isDirectMessageUnread(message('sent'), 'recipient'), true);
    assert.equal(isDirectMessageUnread(message('delivered'), 'recipient'), true);
    assert.equal(isDirectMessageUnread(message('read'), 'recipient'), false);
    assert.equal(isDirectMessageUnread(message('sent'), 'sender'), false);
    assert.equal(isDirectMessageUnread(message('sent', true), 'recipient'), false);
  });

  it('increments on creation once and not on delivery', () => {
    assert.equal(applyDirectUnreadTransition(0, null, message('sent'), 'recipient'), 1);
    assert.equal(applyDirectUnreadTransition(1, message('sent'), message('delivered'), 'recipient'), 1);
    assert.equal(applyDirectUnreadTransition(1, message('delivered'), message('read'), 'recipient'), 0);
  });

  it('ignores the sender and removes unread messages on deletion', () => {
    assert.equal(applyDirectUnreadTransition(0, null, message('sent'), 'sender'), 0);
    assert.equal(applyDirectUnreadTransition(1, message('sent'), { ...message('sent'), deleted: true }, 'recipient'), 0);
    assert.equal(applyDirectUnreadTransition(1, message('read'), null, 'recipient'), 1);
  });

  it('rejects malformed counters and never returns negative totals', () => {
    assert.throws(() => applyDirectUnreadTransition(-1, null, message('sent'), 'recipient'));
    assert.throws(() => applyDirectUnreadTransition(Number.NaN, null, message('sent'), 'recipient'));
    assert.equal(applyDirectUnreadTransition(0, message('sent'), message('read'), 'recipient'), 0);
  });
});
