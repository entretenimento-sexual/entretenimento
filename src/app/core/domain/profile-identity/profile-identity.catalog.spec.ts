import { describe, expect, it } from 'vitest';

import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  SELECTABLE_PROFILE_IDENTITY_OPTIONS,
  isCoupleProfileIdentityCode,
  isSelectableProfileIdentityCode,
  resolveProfileIdentityOption,
} from './profile-identity.catalog';

describe('profile identity catalog', () => {
  it('mantém códigos persistentes separados dos labels de apresentação', () => {
    const option = resolveProfileIdentityOption('casal-ele-ela');

    expect(PROFILE_IDENTITY_CATALOG_VERSION).toBeGreaterThanOrEqual(1);
    expect(option).toMatchObject({
      code: 'casal-ele-ela',
      label: 'Casal (Ele/Ela)',
      shortLabel: 'Casal',
      discoveryGroup: 'couple',
      couple: true,
    });
  });

  it('expõe ao cadastro somente opções habilitadas e selecionáveis', () => {
    expect(SELECTABLE_PROFILE_IDENTITY_OPTIONS.length).toBeGreaterThan(0);
    expect(
      SELECTABLE_PROFILE_IDENTITY_OPTIONS.every(
        (option) => option.enabled && option.selectable
      )
    ).toBe(true);
    expect(isSelectableProfileIdentityCode('mulher')).toBe(true);
    expect(isSelectableProfileIdentityCode('identidade-inexistente')).toBe(false);
  });

  it('deriva comportamento de casal do catálogo, sem lista paralela', () => {
    expect(isCoupleProfileIdentityCode('casal-ele-ele')).toBe(true);
    expect(isCoupleProfileIdentityCode('casal-ela-ela')).toBe(true);
    expect(isCoupleProfileIdentityCode('homem')).toBe(false);
  });
});
