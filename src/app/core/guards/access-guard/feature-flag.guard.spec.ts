import { TestBed } from '@angular/core/testing';
import { Route, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import {
  isFeatureEnabled,
  requireFeatureFlag,
} from './feature-flag.guard';

describe('feature-flag.guard', () => {
  it('considera habilitada apenas uma flag explicitamente true', () => {
    expect(
      isFeatureEnabled('subscriberExperiencesPreview', {
        subscriberExperiencesPreview: true,
      })
    ).toBe(true);

    expect(
      isFeatureEnabled('subscriberExperiencesPreview', {
        subscriberExperiencesPreview: false,
      })
    ).toBe(false);

    expect(isFeatureEnabled('subscriberExperiencesPreview', undefined)).toBe(
      false
    );
  });

  it('permite o carregamento quando a flag está ativa', () => {
    const guard = requireFeatureFlag('subscriberExperiencesPreview', {
      subscriberExperiencesPreview: true,
    });

    const result = TestBed.runInInjectionContext(() =>
      guard({} as Route, [])
    );

    expect(result).toBe(true);
  });

  it('redireciona sem carregar a experiência quando a flag está inativa', () => {
    const redirectTree = { redirected: true };
    const routerMock = {
      createUrlTree: vi.fn(() => redirectTree),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: routerMock }],
    });

    const guard = requireFeatureFlag('subscriberExperiencesPreview', {
      subscriberExperiencesPreview: false,
    });

    const result = TestBed.runInInjectionContext(() =>
      guard({} as Route, [])
    );

    expect(result).toBe(redirectTree);
    expect(routerMock.createUrlTree).toHaveBeenCalledWith([
      '/dashboard/principal',
    ]);
  });
});
