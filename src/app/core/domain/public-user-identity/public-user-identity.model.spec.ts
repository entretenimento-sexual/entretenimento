import { describe, expect, it } from 'vitest';

import { normalizePublicUserIdentity } from './public-user-identity.model';

describe('normalizePublicUserIdentity', () => {
  it('normaliza a mesma identidade para qualquer superfície social', () => {
    const profileId = 'profile-11111111-1111-4111-8111-111111111111';
    const identity = normalizePublicUserIdentity({
      profileId,
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
      profileId,
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

  it('aceita gender legado somente quando ele pertence ao catálogo canônico sem promover uid privado', () => {
    const legacyIdentity = normalizePublicUserIdentity({
      uid: 'legacy-private-id',
      nickname: 'perfil_legado',
      gender: 'mulher',
      municipio: 'Niterói',
      estado: 'RJ',
    });
    const invalidLegacyIdentity = normalizePublicUserIdentity({
      uid: 'legacy-private-id-2',
      nickname: 'perfil_invalido',
      gender: 'valor-fora-do-catalogo',
    });

    expect(legacyIdentity).toMatchObject({
      profileId: null,
      identityCode: 'mulher',
      identityShortLabel: 'Mulher',
      discoveryGroup: 'woman',
      city: 'Niterói',
      state: 'RJ',
    });
    expect(invalidLegacyIdentity?.profileId).toBeNull();
    expect(invalidLegacyIdentity?.identityCode).toBeNull();
    expect(invalidLegacyIdentity?.identityShortLabel).toBeNull();
  });

  it('aceita somente assets locais seguros além de mídia HTTPS/loopback', () => {
    const relativeAsset = normalizePublicUserIdentity({
      nickname: 'perfil_asset',
      photoURL: 'assets/perfis/avatar.webp',
    });
    const rootedAsset = normalizePublicUserIdentity({
      nickname: 'perfil_asset_root',
      photoURL: '/assets/perfis/avatar.webp',
    });
    const traversal = normalizePublicUserIdentity({
      nickname: 'perfil_traversal',
      photoURL: 'assets/../segredo.webp',
    });

    expect(relativeAsset?.avatarUrl).toBe('assets/perfis/avatar.webp');
    expect(rootedAsset?.avatarUrl).toBe('/assets/perfis/avatar.webp');
    expect(traversal?.avatarUrl).toBeNull();
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