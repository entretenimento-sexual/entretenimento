import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildCommunityProfileMembershipIndexProjection,
} from './community-profile-membership-index.projection';
import {
  normalizeCommunityMembershipProfileVisibilityRequest,
} from './community-membership-profile-visibility.model';
import {
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';
import {
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

function community(overrides: Record<string, unknown> = {}) {
  return {
    visibility: 'public_preview',
    status: 'active',
    moderation: { state: 'active' },
    membershipDisclosure: {
      profileMembership: 'opt_in',
      policyVersion: 4,
    },
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    profileVisibility: 'visible',
    profileVisibilityPolicyVersion: 4,
    ...overrides,
  };
}

function discoveryProjection(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    name: 'Comunidade pública',
    slug: 'comunidade-publica',
    description: 'Descrição pública',
    source: { type: 'community', id: 'community-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 10, postCount: 2, mediaCount: 1 },
    access: { join: 'open' },
    tagIds: [],
    ...overrides,
  };
}

test('membership legado e ausência de consentimento permanecem ocultos', () => {
  for (const candidate of [
    { status: 'active' },
    { status: 'active', profileVisibility: undefined },
  ]) {
    assert.equal(
      resolveCommunityMembershipVisibility(community(), candidate).visible,
      false
    );
  }
});

test('hidden permanece oculto e visible válido é público', () => {
  assert.equal(
    resolveCommunityMembershipVisibility(
      community(),
      membership({ profileVisibility: 'hidden' })
    ).visible,
    false
  );
  assert.equal(
    resolveCommunityMembershipVisibility(community(), membership()).visible,
    true
  );
});

test('consentimento de versão antiga da policy permanece oculto', () => {
  assert.equal(
    resolveCommunityMembershipVisibility(
      community(),
      membership({ profileVisibilityPolicyVersion: 3 })
    ).visible,
    false
  );
});

test('revogação canônica vence locator stale imediatamente', () => {
  const staleLocator = buildCommunityProfileMembershipIndexProjection(
    'community-1',
    membership()
  );
  assert.deepEqual(staleLocator, {
    communityId: 'community-1',
    status: 'candidate',
  });

  const revokedCanonicalMembership = membership({
    profileVisibility: 'hidden',
    profileVisibilityPolicyVersion: null,
  });
  assert.equal(
    resolveCommunityMembershipVisibility(
      community(),
      revokedCanonicalMembership
    ).visible,
    false
  );
});

test('membership inativa ou bloqueada não publica', () => {
  for (const status of ['left', 'blocked', 'pending']) {
    assert.equal(
      resolveCommunityMembershipVisibility(
        community(),
        membership({ status })
      ).visible,
      false
    );
  }
});

test('Comunidade arquivada, pausada ou moderada não publica', () => {
  for (const rawCommunity of [
    community({ status: 'archived' }),
    community({ status: 'paused' }),
    community({ moderation: { state: 'pending_review' } }),
  ]) {
    assert.equal(
      resolveCommunityMembershipVisibility(rawCommunity, membership()).visible,
      false
    );
  }
});

test('projection pública ausente ou inválida não produz card', () => {
  assert.equal(
    sanitizeCommunityDiscoveryProjection('community-1', undefined),
    null
  );
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      discoveryProjection({ status: 'archived' })
    ),
    null
  );
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      discoveryProjection({ source: { type: 'community', id: '' } })
    ),
    null
  );
});

test('card público sanitizado descarta UID, role, KYC/KYB e evidências estranhas', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    discoveryProjection({
      uid: 'internal-uid',
      role: 'owner',
      kyc: { status: 'verified' },
      kyb: { recordId: 'secret' },
      evidence: { documentId: 'private' },
      ownerUid: 'owner-secret',
    })
  );

  assert.ok(card);
  const serialized = JSON.stringify(card);
  for (const forbidden of [
    'internal-uid',
    'owner-secret',
    'verified',
    'secret',
    'private',
    '"role"',
    '"kyc"',
    '"kyb"',
    '"evidence"',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('locator continua mínimo e sem autorização/card público', () => {
  assert.deepEqual(
    buildCommunityProfileMembershipIndexProjection('community-1', membership()),
    { communityId: 'community-1', status: 'candidate' }
  );
  assert.equal(
    buildCommunityProfileMembershipIndexProjection(
      'community-1',
      membership({ profileVisibility: 'hidden' })
    ),
    null
  );
});

test('mutação de consentimento deriva o titular do Auth e ignora UID de terceiro', () => {
  const untrustedPayload: unknown = {
    communityId: 'community-1',
    profileVisibility: 'visible',
    subjectUid: 'third-party',
  };
  type VisibilityRequest = Parameters<
    typeof normalizeCommunityMembershipProfileVisibilityRequest
  >[0];
  const normalized = normalizeCommunityMembershipProfileVisibilityRequest(
    untrustedPayload as VisibilityRequest
  );
  assert.deepEqual(normalized, {
    communityId: 'community-1',
    profileVisibility: 'visible',
  });

  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/community/community-membership-profile-visibility.handler.ts'
    ),
    'utf8'
  );
  assert.match(source, /const actorUid = assertAuthenticatedUid\(request\.auth\)/);
  assert.match(source, /collection\('members'\)\.doc\(actorUid\)/);
  assert.doesNotMatch(source, /request\.data\?\.subjectUid/);
  assert.doesNotMatch(source, /doc\(command\.subjectUid\)/);
});

test('perfil público revalida membership canônico antes de ler o card público', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/community/get-profile-public-communities.handler.ts'),
    'utf8'
  );
  const membershipRead = source.indexOf("collection('members').doc(profileUid)");
  const canonicalDecision = source.indexOf('resolveCommunityMembershipVisibility(');
  const discoveryRead = source.indexOf("collection('community_discovery_index').doc(communityId)");

  assert.ok(membershipRead >= 0);
  assert.ok(canonicalDecision > membershipRead);
  assert.ok(discoveryRead > canonicalDecision);
  assert.equal(source.includes("collection('community_user_index')"), false);
});
