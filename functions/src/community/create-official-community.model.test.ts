import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCreateOfficialCommunityRequest,
} from './create-official-community.model';

const TARGETS = [
  { type: 'profile', id: 'profile-1' },
  { type: 'organization', id: 'organization-1' },
  { type: 'venue', id: 'venue-1' },
  { type: 'event', id: 'event-1' },
] as const;

for (const target of TARGETS) {
  test(`normaliza criação oficial para ${target.type} sem autoridade no payload`, () => {
    const result = normalizeCreateOfficialCommunityRequest({
      requestId: 'request-1234567890',
      target,
      name: 'Comunidade Oficial',
      theme: 'interests',
      description: 'Descrição',
      rules: 'Respeitar todas as pessoas.',
      joinPolicy: 'approval',
      tagIds: ['intent:friendship'],
      declarationAccepted: true,
      // Campos abaixo simulam cliente tentando misturar outros domínios.
      authorityRole: 'owner',
      sponsorOrganizationId: 'organization-forjada',
      ownerUid: 'outro-user',
      memberLimit: 25,
    } as Record<string, unknown>);

    assert.ok(result);
    assert.deepEqual(result.target, target);
    assert.equal(result.associationKey, `${target.type}:${target.id}`);
    assert.equal('authorityRole' in result, false);
    assert.equal('sponsorOrganizationId' in result, false);
    assert.equal('ownerUid' in result, false);
    assert.equal('memberLimit' in result, false);
  });
}

test('exige declaração explícita para criação oficial', () => {
  assert.equal(normalizeCreateOfficialCommunityRequest({
    requestId: 'request-1234567890',
    target: { type: 'profile', id: 'profile-1' },
    name: 'Comunidade Oficial',
    theme: 'identity',
    rules: 'Respeitar todas as pessoas.',
    joinPolicy: 'approval',
    tagIds: ['intent:friendship'],
    declarationAccepted: false,
  }), null);
});
