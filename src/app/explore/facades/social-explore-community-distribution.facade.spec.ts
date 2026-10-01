import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SocialExploreCommunityDistributionFacade } from './social-explore-community-distribution.facade';

describe('SocialExploreCommunityDistributionFacade', () => {
  function setup() {
    const vm$ = of({
      recommendations: [],
      activity: [],
      content: [],
    });
    const recordQualifiedExposure = vi.fn();
    const recordOpen = vi.fn();

    const facade = new SocialExploreCommunityDistributionFacade(
      { vm$ } as any,
      { recordQualifiedExposure, recordOpen } as any
    );

    return {
      facade,
      recordQualifiedExposure,
      recordOpen,
    };
  }

  it('expõe a distribuição canônica sem recriar projeção local', () => {
    const { facade } = setup();

    expect(facade.vm$).toBeTruthy();
  });

  it('delega exposição qualificada com a superfície original', () => {
    const { facade, recordQualifiedExposure } = setup();

    facade.recordExposure(
      'community-1',
      'social_explore_recommendation'
    );

    expect(recordQualifiedExposure).toHaveBeenCalledWith(
      'community-1',
      'social_explore_recommendation'
    );
  });

  it('delega abertura com a superfície original', () => {
    const { facade, recordOpen } = setup();

    facade.recordOpen('community-1', 'social_explore_content');

    expect(recordOpen).toHaveBeenCalledWith(
      'community-1',
      'social_explore_content'
    );
  });

  it('gera initials determinísticas sem duplicar regra na página', () => {
    const { facade } = setup();

    expect(facade.initials('Cinema Independente')).toBe('CI');
    expect(facade.initials('  Fotografia  ')).toBe('F');
    expect(facade.initials('')).toBe('?');
  });
});
