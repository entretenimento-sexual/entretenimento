// src/app/core/domain/platform-architecture.manifesto.spec.ts
import { describe, expect, it } from 'vitest';

import { PLATFORM_ARCHITECTURE_MANIFESTO } from './platform-architecture.manifesto';

describe('PLATFORM_ARCHITECTURE_MANIFESTO', () => {
  it('preserva mobile-first, acessibilidade, assinatura e prioridades sociais', () => {
    expect(PLATFORM_ARCHITECTURE_MANIFESTO.interface.mobileFirst).toBe(true);
    expect(PLATFORM_ARCHITECTURE_MANIFESTO.interface.themes).toEqual([
      'light',
      'dark',
      'high-contrast',
    ]);
    expect(PLATFORM_ARCHITECTURE_MANIFESTO.access.tiers).toEqual([
      'basic',
      'premium',
      'vip',
    ]);
    expect(PLATFORM_ARCHITECTURE_MANIFESTO.priorities).toContain('venues');
    expect(PLATFORM_ARCHITECTURE_MANIFESTO.priorities).toContain('rooms');
    expect(
      PLATFORM_ARCHITECTURE_MANIFESTO.security.directStructuralWrites
    ).toBe(false);
  });
});
