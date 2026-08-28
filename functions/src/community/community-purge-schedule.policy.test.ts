// functions/src/community/community-purge-schedule.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { hasCommunityPurgeOperationsPermission } from './community-purge-operations.authorization';
import { resolveCommunityPurgeScheduleOptions } from './community-purge-schedule.policy';

test('purge agendado permanece off sem modo explícito', () => {
  assert.equal(resolveCommunityPurgeScheduleOptions(null).mode, 'off');
  assert.equal(
    resolveCommunityPurgeScheduleOptions({ communityPurgeEnabled: true }).mode,
    'off'
  );
  assert.equal(
    resolveCommunityPurgeScheduleOptions({ communityPurgeMode: 'EXECUTE' }).mode,
    'off'
  );
});

test('dry_run habilita somente observação e execute é explícito', () => {
  assert.equal(
    resolveCommunityPurgeScheduleOptions({ communityPurgeMode: 'dry_run' }).mode,
    'dry_run'
  );
  assert.equal(
    resolveCommunityPurgeScheduleOptions({ communityPurgeMode: 'execute' }).mode,
    'execute'
  );
});

test('limites operacionais são normalizados e restringidos', () => {
  const options = resolveCommunityPurgeScheduleOptions({
    communityPurgeMode: 'dry_run',
    communityPurgeMaxPerRun: 999,
    communityPurgePageSize: 0,
    communityPurgeMaxPagesPerStep: 500,
  });

  assert.equal(options.maxPerRun, 100);
  assert.equal(options.pageSize, 1);
  assert.equal(options.maxPagesPerStep, 100);
});

test('valores não numéricos retornam aos defaults seguros', () => {
  const options = resolveCommunityPurgeScheduleOptions({
    communityPurgeMaxPerRun: 'x',
    communityPurgePageSize: undefined,
    communityPurgeMaxPagesPerStep: Number.NaN,
  });

  assert.equal(options.maxPerRun, 20);
  assert.equal(options.pageSize, 100);
  assert.equal(options.maxPagesPerStep, 30);
});

test('diagnóstico de purge aceita somente administração ou permissão explícita', () => {
  assert.equal(hasCommunityPurgeOperationsPermission({ superadmin: true }), true);
  assert.equal(hasCommunityPurgeOperationsPermission({ admin: true }), true);
  assert.equal(
    hasCommunityPurgeOperationsPermission({ roles: ['ADMIN'] }),
    true
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ permissions: ['community:purge'] }),
    true
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ permissions: ['community:lifecycle'] }),
    true
  );
});

test('moderador comum não recebe acesso operacional ao purge', () => {
  assert.equal(hasCommunityPurgeOperationsPermission({ moderator: true }), false);
  assert.equal(
    hasCommunityPurgeOperationsPermission({ staffRoles: ['moderator'] }),
    false
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ permissions: ['community:moderate'] }),
    false
  );
  assert.equal(hasCommunityPurgeOperationsPermission(null), false);
});
