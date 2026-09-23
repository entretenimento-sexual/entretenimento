import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', relativePath),
    'utf8'
  );
}

test('ledger e placement permanecem atribuídos ao anunciante original', () => {
  const selection = source(
    'community-boost/community-boost-selection.service.ts'
  );

  assert.equal(
    selection.includes('advertiserUid: campaign.advertiserUid'),
    true
  );
  assert.equal(
    selection.includes('ledgerOwnershipTransferred: false'),
    true
  );
  assert.equal(
    selection.includes(
      "collection('community_boost_advertiser_accounts')"
    ),
    true
  );
  assert.equal(
    selection.includes('.doc(input.campaign.advertiserUid)'),
    true
  );
});

test('transferência interrompe campanha aberta antes de trocar ownerUid', () => {
  const ownership = source(
    'community/community-ownership-lifecycle.handler.ts'
  );

  const stopIndex = ownership.indexOf(
    "reason: 'community_ownership_transferred'"
  );
  const ownerMutationIndex = ownership.indexOf(
    'ownerUid: targetUid'
  );

  assert.ok(stopIndex >= 0);
  assert.ok(ownerMutationIndex >= 0);
  assert.ok(
    stopIndex < ownerMutationIndex,
    'Boost precisa ser interrompido antes da troca de proprietário'
  );
});

test('arquivamento interrompe campanha e não transfere ledger', () => {
  const ownership = source(
    'community/community-ownership-lifecycle.handler.ts'
  );
  const lifecycle = source(
    'community/run-community-lifecycle.schedule.ts'
  );
  const authority = source(
    'community-boost/community-boost-authority.service.ts'
  );

  assert.equal(
    ownership.includes("reason: 'community_archived'"),
    true
  );
  assert.equal(
    lifecycle.includes("reason: 'community_lifecycle_archived'"),
    true
  );
  assert.equal(
    authority.includes('ledgerOwnershipTransferred: false'),
    true
  );
  assert.equal(
    authority.includes("status: 'canceled'"),
    true
  );
});

test('resume de campanha pausada perdida cancela antes de devolver erro', () => {
  const manage = source(
    'community-boost/manage-community-boost-campaign.handler.ts'
  );

  assert.equal(
    manage.includes('stopCommunityBoostForAuthorityLossInTransaction'),
    true
  );
  assert.equal(
    manage.includes("resultReason: 'community_boost_authority_invalid'"),
    true
  );
  assert.equal(
    manage.includes('if (result.authorityLost)'),
    true
  );
});
