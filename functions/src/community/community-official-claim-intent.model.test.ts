import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSubmitCommunityOfficialClaimIntentRequest,
  normalizeSubmitCommunityOfficialClaimRequest,
} from './community-official-claim.model';

test('aceita intenção segura sem expor autoridade nem evidência ao cliente', () => {
  const intent = normalizeSubmitCommunityOfficialClaimIntentRequest({
    requestId: 'request-1',
    communityId: 'community-1',
    target: { type: 'venue', id: 'venue-1' },
    declarationAccepted: true,
  });

  assert.deepEqual(intent, {
    requestId: 'request-1',
    communityId: 'community-1',
    target: { type: 'venue', id: 'venue-1' },
    associationKey: 'venue:venue-1',
  });
});

test('intenção segura não é confundida com comando privado completo', () => {
  const raw = {
    requestId: 'request-1',
    communityId: 'community-1',
    target: { type: 'venue', id: 'venue-1' },
    declarationAccepted: true,
  };

  assert.ok(normalizeSubmitCommunityOfficialClaimIntentRequest(raw));
  assert.equal(normalizeSubmitCommunityOfficialClaimRequest(raw), null);
});
