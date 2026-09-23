import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  friendRequestCounterpartUid,
} from './get-pending-friend-requests.handler';

describe('pending friend requests backend-time boundary', () => {
  const request = {
    requesterUid: 'requester-1',
    targetUid: 'target-1',
  };

  it('resolve a contraparte correta conforme a direção', () => {
    assert.equal(
      friendRequestCounterpartUid(request, 'inbound'),
      'requester-1'
    );
    assert.equal(
      friendRequestCounterpartUid(request, 'outbound'),
      'target-1'
    );
  });

  it('falha fechado para UID inválido da contraparte', () => {
    assert.equal(
      friendRequestCounterpartUid(
        { requesterUid: 'bad/uid', targetUid: 'target-1' },
        'inbound'
      ),
      ''
    );
  });
});
