import { describe, expect, it } from 'vitest';

import {
  buildCommunityOfficialClaimCapabilityCandidateKey,
  normalizeCommunityOfficialClaimCapabilityResponse,
} from './community-official-claim-capability.model';

const GENERATED_AT = 1_800_000_000_000;

describe('community official claim capability model', () => {
  it('aceita Local e Organização com os papéis públicos permitidos', () => {
    const result = normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [
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
    expect(result?.candidates).toHaveLength(2);
    expect(result?.candidates[1]).toEqual({
      target: { type: 'organization', id: 'shared-1' },
      label: 'Organização Um',
      authorityRole: 'authorized_representative',
    });
  });

  it('mantém a seleção distinta quando Local e Organização compartilham id', () => {
    expect(buildCommunityOfficialClaimCapabilityCandidateKey({
      target: { type: 'venue', id: 'shared-1' },
    })).toBe('venue:shared-1');
    expect(buildCommunityOfficialClaimCapabilityCandidateKey({
      target: { type: 'organization', id: 'shared-1' },
    })).toBe('organization:shared-1');
  });

  it('falha fechado para alvo ainda não habilitado', () => {
    expect(normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [{
        target: { type: 'event', id: 'event-1' },
        label: 'Evento Um',
        authorityRole: 'manager',
      }],
    })).toBeNull();
  });

  it('falha fechado para papel de autoridade fora da projeção pública', () => {
    expect(normalizeCommunityOfficialClaimCapabilityResponse({
      canSubmit: true,
      reason: 'eligible',
      generatedAt: GENERATED_AT,
      candidates: [{
        target: { type: 'organization', id: 'organization-1' },
        label: 'Organização Um',
        authorityRole: 'admin',
      }],
    })).toBeNull();
  });
});
