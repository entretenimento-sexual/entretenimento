import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readHandlerSource(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      'src/community/get-official-communities-for-target.handler.ts'
    ),
    'utf8'
  );
}

test('alvo profile exige projeção pública antes da associação oficial', () => {
  const source = readHandlerSource();
  const profileBranch = source.indexOf("command.target.type === 'profile'");
  const publicProfileRead = source.indexOf(".collection('public_profiles')");
  const officialQuery = source.indexOf('return loadOfficialCommunitiesForTarget(');

  assert.ok(profileBranch >= 0);
  assert.ok(publicProfileRead > profileBranch);
  assert.ok(officialQuery > publicProfileRead);
  assert.match(source, /\.where\('profileId', '==', command\.target\.id\)/);
  assert.match(source, /\.limit\(2\)/);
});

test('alvo profile respeita bloqueio bilateral antes da associação oficial', () => {
  const source = readHandlerSource();
  const blockCheck = source.indexOf('assertNoActiveBilateralBlock(');
  const officialQuery = source.indexOf('return loadOfficialCommunitiesForTarget(');

  assert.ok(blockCheck >= 0);
  assert.ok(officialQuery > blockCheck);
});

test('alvo profile duplicado ou inválido falha fechado', () => {
  const source = readHandlerSource();

  assert.match(source, /if \(publicProfilesSnapshot\.size > 1\)/);
  assert.match(source, /public_profile_identity_duplicate/);
  assert.match(source, /public_profile_identity_invalid/);
  assert.match(source, /'data-loss'/);
});

test('alvos não-profile continuam no query canônico sem resolução de UID', () => {
  const source = readHandlerSource();

  assert.match(source, /if \(command\.target\.type === 'profile'\) \{/);
  assert.match(
    source,
    /return loadOfficialCommunitiesForTarget\(command\.target, command\.limit\)/
  );
});

test('perfil legado com campo privado não revela associações oficiais', () => {
  const source = readHandlerSource();
  const profileRead = source.indexOf(".collection('public_profiles')");
  const legacyDeny = source.indexOf('if (hasLegacyPrivateDiscoveryFields(targetProfileSnapshot.data()))');
  const blockCheck = source.indexOf('await assertNoActiveBilateralBlock(');
  const load = source.indexOf('return loadOfficialCommunitiesForTarget(');
  assert.ok(profileRead >= 0 && legacyDeny > profileRead);
  assert.ok(blockCheck > legacyDeny && load > blockCheck);
  assert.match(source.slice(legacyDeny, blockCheck), /return emptyResponse\(\)/);
});
