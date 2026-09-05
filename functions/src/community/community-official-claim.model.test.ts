import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSubmitCommunityOfficialClaimIntentRequest,
  normalizeSubmitCommunityOfficialClaimRequest,
} from './community-official-claim.model';

test('intent do cliente ignora autoridade, organização e evidências fornecidas', () => {
  const result = normalizeSubmitCommunityOfficialClaimIntentRequest({
    requestId: 'request-1',
    communityId: 'community-1',
    target: { type: 'organization', id: 'organization-1' },
    declarationAccepted: true,
    authorityRole: 'owner',
    sponsorOrganizationId: 'forged-organization',
    evidenceReferences: [
      { type: 'authority_record', referenceId: 'forged-reference' },
    ],
  });

  assert.deepEqual(result, {
    requestId: 'request-1',
    communityId: 'community-1',
    target: { type: 'organization', id: 'organization-1' },
    associationKey: 'organization:organization-1',
  });
});

test('normalizador interno preserva referência composta canônica acima de 128 caracteres', () => {
  const organizationId = `org-${'o'.repeat(96)}`;
  const holderUid = `uid-${'u'.repeat(96)}`;
  const representationReferenceId = `${organizationId}:${holderUid}`;

  assert.ok(organizationId.length <= 128);
  assert.ok(holderUid.length <= 128);
  assert.ok(representationReferenceId.length > 128);
  assert.ok(representationReferenceId.length <= 320);

  const result = normalizeSubmitCommunityOfficialClaimRequest({
    requestId: 'request-2',
    communityId: 'community-1',
    target: { type: 'organization', id: organizationId },
    declarationAccepted: true,
    authorityRole: 'authorized_representative',
    sponsorOrganizationId: organizationId,
    evidenceReferences: [
      {
        type: 'organization_kyb_record',
        referenceId: organizationId,
      },
      {
        type: 'authority_record',
        referenceId: representationReferenceId,
      },
    ],
  });

  assert.ok(result);
  assert.equal(
    result.evidenceReferences.find((item) => item.type === 'authority_record')
      ?.referenceId,
    representationReferenceId
  );
});

test('normalizador interno rejeita referência opaca acima do limite canônico', () => {
  const result = normalizeSubmitCommunityOfficialClaimRequest({
    requestId: 'request-3',
    communityId: 'community-1',
    target: { type: 'organization', id: 'organization-1' },
    declarationAccepted: true,
    authorityRole: 'authorized_representative',
    sponsorOrganizationId: 'organization-1',
    evidenceReferences: [
      {
        type: 'organization_kyb_record',
        referenceId: 'organization-1',
      },
      {
        type: 'authority_record',
        referenceId: 'a'.repeat(321),
      },
    ],
  });

  assert.equal(result, null);
});
