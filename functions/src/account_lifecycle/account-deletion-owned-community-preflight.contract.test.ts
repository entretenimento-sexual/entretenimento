import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const purgeSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'account_lifecycle', 'purgeDeletedAccounts.ts'),
  'utf8'
);

test('purge bloqueia owner de Comunidade antes de remover identidade Auth', () => {
  for (const required of [
    'ensureCommunityOwnerTerminalSuccessionCasesInTransaction',
    "trigger: 'owner_terminally_unavailable'",
    'blockedByOwnedCommunities',
    'owner-terminal-succession-in-progress',
    "purgePhase: 'blocked'",
    "dataDeletionBlockers: ['community_memberships']",
    "accountStatus: 'deleted'",
    'loginAllowed: false',
  ]) {
    assert.equal(
      purgeSource.includes(required),
      true,
      'preflight de ownership ausente: ' + required
    );
  }

  const ownershipGate = purgeSource.indexOf(
    'if (claim.blockedByOwnedCommunities)'
  );
  const authDeletion = purgeSource.indexOf(
    'const authResult = await deleteAuthUser(candidate, now)'
  );

  assert.ok(ownershipGate >= 0);
  assert.ok(authDeletion >= 0);
  assert.ok(
    ownershipGate < authDeletion,
    'ownership precisa bloquear purge antes de deleteAuthUser'
  );
});

test('preflight abre sucessão terminal mas não remove Auth', () => {
  const successionOpen = purgeSource.indexOf(
    'ensureCommunityOwnerTerminalSuccessionCasesInTransaction'
  );
  const authDeletion = purgeSource.indexOf(
    'const authResult = await deleteAuthUser(candidate, now)'
  );

  assert.ok(successionOpen >= 0);
  assert.ok(authDeletion >= 0);
  assert.ok(successionOpen < authDeletion);
});

test('preflight não promove sucessor automaticamente', () => {
  for (const forbidden of [
    'autoSuccessor',
    'automaticSuccessor',
    'inheritOwner',
    'promoteToOwner',
  ]) {
    assert.equal(
      purgeSource.includes(forbidden),
      false,
      'purge não pode escolher herdeiro automaticamente: ' + forbidden
    );
  }
});
