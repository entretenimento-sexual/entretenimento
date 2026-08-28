// functions/src/community/community-membership-activity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { isCommunityMembershipTransitionMeaningful } from './community-membership-activity.policy';

test('considera entrada e aprovação como atividade significativa', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(null, { status: 'active' }),
    true
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'pending' },
      { status: 'active' }
    ),
    true
  );
});

test('considera saída ou bloqueio de membro ativo como atividade significativa', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active' },
      { status: 'left' }
    ),
    true
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active' },
      { status: 'blocked' }
    ),
    true
  );
});

test('não mantém Comunidade viva apenas por solicitação pendente ou rejeitada', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(null, { status: 'pending' }),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'pending' },
      { status: 'left' }
    ),
    false
  );
});

test('ignora atualização sem mudança real de status', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active' },
      { status: 'active' }
    ),
    false
  );
});
