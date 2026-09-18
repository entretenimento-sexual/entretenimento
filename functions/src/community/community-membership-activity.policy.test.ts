// functions/src/community/community-membership-activity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { isCommunityMembershipTransitionMeaningful } from './community-membership-activity.policy';

test('considera somente a primeira entrada ou aprovação como atividade significativa', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(null, { status: 'active' }),
    true
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'pending', joinedAt: null },
      { status: 'active', joinedAt: 2_000 }
    ),
    true
  );
});

test('reentrada não renova atividade quando já existe histórico de joinedAt', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'left', joinedAt: 1_000 },
      { status: 'active', joinedAt: 2_000 }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'pending', joinedAt: 1_000 },
      { status: 'active', joinedAt: 2_000 }
    ),
    false
  );
});

test('saída, bloqueio e desbloqueio não renovam o relógio', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active', joinedAt: 1_000 },
      { status: 'left', joinedAt: 1_000 }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active', joinedAt: 1_000 },
      { status: 'blocked', joinedAt: 1_000 }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'blocked', joinedAt: 1_000 },
      { status: 'active', joinedAt: 1_000 }
    ),
    false
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

test('falha fechado quando o estado anterior ou atual é inválido', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'unknown' },
      { status: 'active', joinedAt: 2_000 }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 123 },
      { status: 'active', joinedAt: 2_000 }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      null,
      { status: 'unknown' }
    ),
    false
  );
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'pending' },
      { status: null }
    ),
    false
  );
});

test('ignora atualização sem mudança real de status', () => {
  assert.equal(
    isCommunityMembershipTransitionMeaningful(
      { status: 'active', joinedAt: 1_000 },
      { status: 'active', joinedAt: 1_000 }
    ),
    false
  );
});
