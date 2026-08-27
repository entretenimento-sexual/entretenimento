import { describe, expect, it } from 'vitest';

import { normalizePublicUserIdentity } from './public-user-identity.model';

describe('normalizePublicUserIdentity', () => {
  it('normaliza a mesma identidade para qualquer superfície social', () => {
    const identity = normalizePublicUserIdentity({
      profileId: 'user-1',
      nickname: 'serale',
      avatarUrl: 'https://example.com/avatar.webp',
      identityCode: 'mulher',
      identityLabel: 'Mulher',
      identityShortLabel: 'Mulher',
      discoveryGroup: 'woman',
      city: 'Rio de Janeiro',
      state: 'rj',
    });

    expect(identity).toMatchObject({
      profileId: 'user-1',
      nickname: 'serale',
      label: 'serale',
      identityCode: 'mulher',
      identityShortLabel: 'Mulher',
      discoveryGroup: 'woman',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'woman',
      profileTypeLabel: 'Mulher',
    });
  });

  it('aceita aliases legados durante a migração sem expor campos desconhecidos', () => {
    const identity = normalizePublicUserIdentity({
      label: 'casal_rio',
      avatarUrl: 'https://example.com/casal.webp',
      profileType: 'couple',
      profileTypeLabel: 'Casal',
      municipio: 'Niterói',
      estado: 'RJ',
      civilName: 'não deve atravessar',
      address: 'não deve atravessar',
    });

    expect(identity?.nickname).toBe('casal_rio');
    expect(identity?.profileType).toBe('couple');
    expect(identity?.city).toBe('Niterói');
    expect('civilName' in (identity ?? {})).toBe(false);
    expect('address' in (identity ?? {})).toBe(false);
  });

  it('falha fechado para UF e URL remota inseguras', () => {
    const identity = normalizePublicUserIdentity({
      nickname: 'perfil_seguro',
      avatarUrl: 'http://example.com/avatar.jpg',
      state: 'Rio de Janeiro',
    });
    const invalidUf = normalizePublicUserIdentity({
      nickname: 'outro_perfil',
      state: 'RI',
    });

    expect(identity?.avatarUrl).toBeNull();
    expect(identity?.state).toBeNull();
    expect(invalidUf?.state).toBeNull();
  });
});
