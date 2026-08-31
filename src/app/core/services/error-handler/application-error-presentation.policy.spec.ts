// src/app/core/services/error-handler/application-error-presentation.policy.spec.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR PRESENTATION POLICY - CONTRACT TESTS
// -----------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  normalizeApplicationErrorInternalRoute,
  normalizeApplicationErrorPresentation,
} from './application-error-presentation.policy';

describe('application-error-presentation.policy', () => {
  it('aceita somente rotas internas seguras', () => {
    expect(
      normalizeApplicationErrorInternalRoute(
        '/subscription-plan?minimumRole=basic'
      )
    ).toBe('/subscription-plan?minimumRole=basic');

    expect(
      normalizeApplicationErrorInternalRoute('https://example.com/fora')
    ).toBeNull();
    expect(normalizeApplicationErrorInternalRoute('//example.com/fora')).toBeNull();
    expect(normalizeApplicationErrorInternalRoute('/\\example.com/fora')).toBeNull();
    expect(normalizeApplicationErrorInternalRoute('/rota\nquebrada')).toBeNull();
  });

  it('normaliza payload visual e remove rota inválida', () => {
    expect(
      normalizeApplicationErrorPresentation({
        surface: 'modal',
        severity: 'info',
        title: '  Plano necessário  ',
        primaryAction: {
          label: '  Continuar  ',
          route: 'https://example.com',
        },
      })
    ).toEqual({
      surface: 'modal',
      severity: 'info',
      title: 'Plano necessário',
      primaryAction: {
        label: 'Continuar',
      },
    });
  });

  it('cai no padrão seguro para apresentação ausente', () => {
    expect(normalizeApplicationErrorPresentation(undefined)).toEqual({
      surface: 'snackbar',
      severity: 'error',
    });
  });
});
