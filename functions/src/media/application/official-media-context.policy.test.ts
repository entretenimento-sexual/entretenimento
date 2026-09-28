import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOfficialMediaContextProjection,
  deriveOfficialMediaContextEntry,
  officialMediaContextMatches,
} from './official-media-context.policy';

const NOW = 1_800_000_000_000;

function association(input: {
  type: 'profile' | 'organization' | 'venue' | 'event';
  id: string;
  role: string;
  source: string;
  policyVersion: number;
}) {
  return {
    associationKey: `${input.type}:${input.id}`,
    communityId: `community-${input.type}`,
    target: { type: input.type, id: input.id },
    status: 'verified',
    authority: {
      holderUid: 'owner-1',
      role: input.role,
    },
    verification: {
      source: input.source,
      policyVersion: input.policyVersion,
      verifiedAt: NOW - 10_000,
      revalidationDueAt: NOW + 30_000,
      expiresAt: NOW + 60_000,
    },
    activeRevalidationDueAt: NOW + 30_000,
    activeVerificationExpiresAt: NOW + 60_000,
    revokedAt: null,
  };
}

function verifiedKyc() {
  return {
    uid: 'owner-1',
    profileId: 'profile-1',
    status: 'verified',
    verifiedAt: NOW - 10_000,
    policyVersion: 1,
    expiresAt: NOW + 60_000,
    revalidationDueAt: NOW + 30_000,
    revokedAt: null,
  };
}

function organizationKyb() {
  return {
    organizationId: 'organization-1',
    status: 'verified',
    verifiedAt: NOW - 10_000,
    policyVersion: 2,
    expiresAt: NOW + 60_000,
    revalidationDueAt: NOW + 30_000,
    revokedAt: null,
  };
}

function organizationRepresentation() {
  return {
    organizationId: 'organization-1',
    holderUid: 'owner-1',
    role: 'owner',
    scopes: ['community_official_claim'],
    status: 'active',
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    revokedAt: null,
  };
}

function venueGrant() {
  return {
    holderUid: 'owner-1',
    organizationId: 'organization-venue',
    scope: 'verified_commercial_authority',
    policyVersion: 3,
    verificationStatus: 'verified',
    active: true,
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
  };
}

function eventAuthority() {
  return {
    eventId: 'event-1',
    holderUid: 'owner-1',
    role: 'organizer',
    eventStatus: 'active',
    status: 'active',
    sponsorOrganizationId: 'organization-event',
    policyVersion: 1,
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    revalidationDueAt: NOW + 30_000,
    revokedAt: null,
  };
}

describe('official-media-context.policy', () => {
  it('deriva Profile reutilizando identidade + KYC canônicos', () => {
    const entry = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'profile',
        id: 'profile-1',
        role: 'self',
        source: 'profile_verification',
        policyVersion: 1,
      }),
      rawUser: { profileId: 'profile-1' },
      rawProfileKyc: verifiedKyc(),
      nowMs: NOW,
    });

    assert.deepEqual(entry, {
      identity: { verified: true, type: 'profile' },
      association: { verified: true },
      target: { type: 'profile', id: 'profile-1' },
    });
  });

  it('deriva Organization reutilizando KYB + representation', () => {
    const entry = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'organization',
        id: 'organization-1',
        role: 'owner',
        source: 'organization_verification',
        policyVersion: 2,
      }),
      rawTarget: {
        organizationId: 'organization-1',
        status: 'active',
      },
      rawOrganizationKyb: organizationKyb(),
      rawOrganizationRepresentation: organizationRepresentation(),
      nowMs: NOW,
    });

    assert.equal(entry?.target.type, 'organization');
    assert.equal(entry?.target.id, 'organization-1');
  });

  it('deriva Venue reutilizando grant comercial + ownership do target', () => {
    const entry = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'venue',
        id: 'venue-1',
        role: 'authorized_representative',
        source: 'official_space_creation_grant',
        policyVersion: 3,
      }),
      rawTarget: {
        status: 'active',
        ownerUid: 'owner-1',
        adminUids: [],
      },
      rawCommercialGrant: venueGrant(),
      nowMs: NOW,
    });

    assert.equal(entry?.target.type, 'venue');
    assert.equal(entry?.target.id, 'venue-1');
  });

  it('deriva Event reutilizando event authority vigente', () => {
    const entry = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'event',
        id: 'event-1',
        role: 'organizer',
        source: 'event_authorization',
        policyVersion: 1,
      }),
      rawEventAuthority: eventAuthority(),
      nowMs: NOW,
    });

    assert.equal(entry?.target.type, 'event');
    assert.equal(entry?.target.id, 'event-1');
  });

  it('agrega múltiplos targets sem escolher entidade por heurística', () => {
    const profile = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'profile',
        id: 'profile-1',
        role: 'self',
        source: 'profile_verification',
        policyVersion: 1,
      }),
      rawUser: { profileId: 'profile-1' },
      rawProfileKyc: verifiedKyc(),
      nowMs: NOW,
    });
    const event = deriveOfficialMediaContextEntry({
      ownerUid: 'owner-1',
      rawAssociation: association({
        type: 'event',
        id: 'event-1',
        role: 'organizer',
        source: 'event_authorization',
        policyVersion: 1,
      }),
      rawEventAuthority: eventAuthority(),
      nowMs: NOW,
    });

    assert.deepEqual(buildOfficialMediaContextProjection([event, profile]), {
      contexts: [
        profile,
        event,
      ],
    });
  });

  it('falha fechado quando associação ou autoridade deixam de valer', () => {
    assert.equal(
      deriveOfficialMediaContextEntry({
        ownerUid: 'owner-1',
        rawAssociation: {
          ...association({
            type: 'event',
            id: 'event-1',
            role: 'organizer',
            source: 'event_authorization',
            policyVersion: 1,
          }),
          activeRevalidationDueAt: NOW,
        },
        rawEventAuthority: eventAuthority(),
        nowMs: NOW,
      }),
      null
    );

    assert.equal(
      deriveOfficialMediaContextEntry({
        ownerUid: 'owner-1',
        rawAssociation: association({
          type: 'organization',
          id: 'organization-1',
          role: 'owner',
          source: 'organization_verification',
          policyVersion: 2,
        }),
        rawTarget: {
          organizationId: 'organization-1',
          status: 'active',
        },
        rawOrganizationKyb: {
          ...organizationKyb(),
          status: 'revoked',
        },
        rawOrganizationRepresentation: organizationRepresentation(),
        nowMs: NOW,
      }),
      null
    );
  });

  it('não trata projection divergente como contexto válido', () => {
    const expected = buildOfficialMediaContextProjection([
      deriveOfficialMediaContextEntry({
        ownerUid: 'owner-1',
        rawAssociation: association({
          type: 'profile',
          id: 'profile-1',
          role: 'self',
          source: 'profile_verification',
          policyVersion: 1,
        }),
        rawUser: { profileId: 'profile-1' },
        rawProfileKyc: verifiedKyc(),
        nowMs: NOW,
      }),
    ]);

    assert.ok(expected);
    assert.equal(officialMediaContextMatches({
      contexts: [{
        identity: { verified: true, type: 'profile' },
        association: { verified: true },
        target: { type: 'profile', id: 'profile-2' },
      }],
    }, expected), false);
  });
});
