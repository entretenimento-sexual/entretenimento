import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_MODE_CONFIGS,
  DISCOVERY_MODE_TABS,
  discoveryModeRequiresLocation,
  discoveryModeRequiresOnlinePresence,
  isDiscoveryModeEnabled,
  normalizeDiscoveryMode,
} from './discovery-mode.model';

describe('discovery-mode.model', () => {
  it('mantém todos como fallback para valores desconhecidos', () => {
    expect(normalizeDiscoveryMode('desconhecido')).toBe('all');
  });

  it('declara hoje como modo habilitado baseado em status temporário', () => {
    expect(isDiscoveryModeEnabled('today')).toBe(true);
    expect(DISCOVERY_MODE_CONFIGS.today.source).toBe('intent_status');
  });

  it('não exige GPS nem presença online para o modo hoje', () => {
    expect(discoveryModeRequiresLocation('today')).toBe(false);
    expect(discoveryModeRequiresOnlinePresence('today')).toBe(false);
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
