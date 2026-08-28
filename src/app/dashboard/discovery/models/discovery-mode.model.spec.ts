import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_MODE_CONFIGS,
  DISCOVERY_MODE_TABS,
  discoveryModeRequiresLocation,
  discoveryModeRequiresOnlinePresence,
  getDiscoveryModeAccessPolicy,
  isDiscoveryModeEnabled,
  normalizeDiscoveryExperienceMode,
  normalizeDiscoveryMode,
} from './discovery-mode.model';

describe('discovery-mode.model', () => {
  it('mantém todos como fallback para valores desconhecidos', () => {
    expect(normalizeDiscoveryMode('desconhecido')).toBe('all');
  });

  it('separa experiência de hoje do pipeline de ranking de perfis', () => {
    expect(normalizeDiscoveryExperienceMode('today')).toBe('today');
    expect(normalizeDiscoveryMode('today')).toBe('all');
  });

  it('declara hoje como modo habilitado baseado em status temporário', () => {
    expect(isDiscoveryModeEnabled('today')).toBe(true);
    expect(DISCOVERY_MODE_CONFIGS.today.source).toBe('intent_status');
  });

  it('não exige GPS nem presença online para o modo hoje', () => {
    expect(discoveryModeRequiresLocation('today')).toBe(false);
    expect(discoveryModeRequiresOnlinePresence('today')).toBe(false);
  });

  it('mantém os modos atuais sem bloqueio de assinatura implícito', () => {
    expect(getDiscoveryModeAccessPolicy('all')).toBeNull();
    expect(getDiscoveryModeAccessPolicy('today')).toBeNull();
  });

  it('expõe hoje como aba navegável e mantém perto planejado', () => {
    expect(
      DISCOVERY_MODE_TABS.find((tab) => tab.id === 'today')?.disabled
    ).toBe(false);
    expect(
      DISCOVERY_MODE_TABS.find((tab) => tab.id === 'nearby')?.disabled
    ).toBe(true);
  });
});
