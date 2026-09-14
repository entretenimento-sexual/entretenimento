import { describe, expect, it } from 'vitest';

import {
  buildCommunityOfficialClaimCapabilityCandidateKey,
  normalizeCommunityOfficialClaimCapabilityResponse,
} from './community-official-claim-capability.model';

const GENERATED_AT = 1_800_000_000_000;

describe('community official claim capability model', () => {
  it('projeta somente alvo e rótulo mesmo quando a resposta traz campos privados ou papel de autoridade', () => {
    const result = normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [
        {
          target: { type: 'profile', id: 'profile-1' },
          label: 'Meu perfil',
          authorityRole: 'self',
          kycStatus: 'verified',
          verifiedAt: GENERATED_AT - 1_000,
        },
        {
          target: { type: 'venue', id: 'shared-1' },
          label: 'Local Um',
          authorityRole: 'owner',
        },
        {
          target: { type: 'organization', id: 'shared-1' },
          label: 'Organização Um',
          authorityRole: 'authorized_representative',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.candidates).toHaveLength(3);
    expect(result?.candidates[0]).toEqual({
      target: { type: 'profile', id: 'profile-1' },
      label: 'Meu perfil',
    });
    expect(result?.candidates[0]).not.toHaveProperty('authorityRole');
    expect(result?.candidates[0]).not.toHaveProperty('kycStatus');
    expect(result?.candidates[0]).not.toHaveProperty('verifiedAt');
  });

  it('aceita a projeção mínima sem papel de autoridade', () => {
    expect(normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [{
        target: { type: 'venue', id: 'venue-1' },
        label: 'Local Um',
      }],
    })?.candidates).toEqual([{ // contrato novo tolerante a rollout de backend
      target: { type: 'venue', id: 'venue-1' },
      label: 'Local Um',
    }]);
  });

  it('mantém a seleção distinta quando tipos diferentes compartilham id', () => {
    expect(buildCommunityOfficialClaimCapabilityCandidateKey({
      target: { type: 'profile', id: 'shared-1' },
    })).toBe('profile:shared-1');
    expect(buildCommunityOfficialClaimCapabilityCandidateKey({
      target: { type: 'venue', id: 'shared-1' },
    })).toBe('venue:shared-1');
    expect(buildCommunityOfficialClaimCapabilityCandidateKey({
      target: { type: 'organization', id: 'shared-1' },
    })).toBe('organization:shared-1');
  });

  it('mantém Event fail-closed', () => {
    expect(normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [{
        target: { type: 'event', id: 'event-1' },
        label: 'Evento Um',
      }],
    })).toBeNull();
  });
});
