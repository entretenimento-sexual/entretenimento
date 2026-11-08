import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readHandlerSource(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      'src/community/get-profile-official-communities.handler.ts'
    ),
    'utf8'
  );
}

test('perfil oficial exige projeção pública antes da associação canônica', () => {
  const source = readHandlerSource();
  const publicProfileRead = source.indexOf(".collection('public_profiles')");
  const officialQuery = source.indexOf('return loadOfficialCommunitiesForTarget(');

  assert.ok(publicProfileRead >= 0);
  assert.ok(officialQuery > publicProfileRead);
  assert.match(source, /\.where\('profileId', '==', command\.profileId\)/);
  assert.match(source, /\.limit\(2\)/);
  assert.match(source, /if \(!targetProfileSnapshot\) \{/);
});

test('perfil oficial respeita bloqueio bilateral antes de carregar a associação', () => {
  const source = readHandlerSource();
  const blockCheck = source.indexOf('assertNoActiveBilateralBlock(');
  const officialQuery = source.indexOf('return loadOfficialCommunitiesForTarget(');

  assert.ok(blockCheck >= 0);
  assert.ok(officialQuery > blockCheck);
});

test('profileId duplicado falha fechado em vez de escolher UID arbitrário', () => {
  const source = readHandlerSource();

  assert.match(source, /if \(publicProfilesSnapshot\.size > 1\)/);
  assert.match(source, /public_profile_identity_duplicate/);
  assert.match(source, /'data-loss'/);
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
