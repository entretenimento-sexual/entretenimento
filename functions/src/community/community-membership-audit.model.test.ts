import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommunityMembershipReviewAudit } from './community-membership-audit.model';

test('auditoria de aprovação preserva papel do operador e papel resultante do membro', () => {
  const createdAt = { serverTimestamp: true };

  const audit = buildCommunityMembershipReviewAudit(
    {
      action: 'community-membership-approved',
      communityId: 'community-1',
      actorUid: 'moderator-1',
      actorRole: 'moderator',
      subjectUid: 'member-1',
      status: 'active',
    },
    createdAt
  );

  assert.deepEqual(audit, {
    action: 'community-membership-approved',
    communityId: 'community-1',
    actorUid: 'moderator-1',
    actorRole: 'moderator',
    subjectUid: 'member-1',
    status: 'active',
    role: 'member',
    createdAt,
    source: 'callable',
  });
});

test('auditoria de recusa também preserva o papel administrativo do operador', () => {
  const audit = buildCommunityMembershipReviewAudit(
    {
      action: 'community-membership-rejected',
      communityId: 'community-1',
      actorUid: 'admin-1',
      actorRole: 'admin',
      subjectUid: 'member-2',
      status: 'left',
    },
    123
  );

  assert.equal(audit.actorRole, 'admin');
  assert.equal(audit.role, 'member');
  assert.equal(audit.status, 'left');
  assert.equal(audit.source, 'callable');
});

test('falha fechado quando a policy não informa ação de auditoria', () => {
  assert.throws(
    () =>
      buildCommunityMembershipReviewAudit(
        {
          action: null,
          communityId: 'community-1',
          actorUid: 'moderator-1',
          actorRole: 'moderator',
          subjectUid: 'member-3',
          status: 'active',
        },
        123
      ),
    /não informou uma ação de auditoria/i
  );
});
