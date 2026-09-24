// src/app/community/community-component-orchestration-boundary.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const COMMUNITY_ROOT = resolve(process.cwd(), 'src/app/community');

function source(relativePath: string): string {
  return readFileSync(resolve(COMMUNITY_ROOT, relativePath), 'utf8');
}

function lineCount(value: string): number {
  return value.split(/\r?\n/u).length;
}

describe('Community component orchestration boundary', () => {
  it('mantém Discovery como adaptador de view, sem reabsorver data/boost/notification orchestration', () => {
    const component = source('discovery/community-discovery-page.component.ts');

    expect(lineCount(component)).toBeLessThanOrEqual(750);
    expect(component).not.toContain('inject(CommunityPreviewRepository)');
    expect(component).not.toContain('inject(CommunityDiscoveryCacheService)');
    expect(component).not.toContain('inject(CommunityBoostRepository)');
    expect(component).not.toContain(
      'inject(CommunityNotificationPreferenceService)'
    );
    expect(component).toContain('inject(CommunityDiscoveryDataFacade)');
    expect(component).toContain('inject(CommunityDiscoveryMineFacade)');
    expect(component).toContain('inject(CommunityDiscoverySponsoredFacade)');
  });

  it('mantém Feed como adaptador de view, sem reabsorver timeline/moderação/mapa', () => {
    const component = source('feed/community-feed.component.ts');

    expect(lineCount(component)).toBeLessThanOrEqual(800);
    expect(component).not.toContain('inject(CommunityFeedRepository)');
    expect(component).not.toContain(
      'inject(CommunityRealtimeAttentionCoordinatorService)'
    );
    expect(component).not.toContain('inject(DomSanitizer)');
    expect(component).not.toContain('moderatePost$(');
    expect(component).toContain('inject(CommunityFeedTimelineFacade)');
    expect(component).toContain('inject(CommunityFeedModerationFacade)');
    expect(component).toContain('inject(CommunityFeedLocationFacade)');
  });

  it('impede substituir god components por god facades', () => {
    const facadePaths = [
      'discovery/community-discovery-data.facade.ts',
      'discovery/community-discovery-mine.facade.ts',
      'discovery/community-discovery-sponsored.facade.ts',
      'feed/community-feed-timeline.facade.ts',
      'feed/community-feed-moderation.facade.ts',
      'feed/community-feed-location.facade.ts',
    ] as const;

    for (const path of facadePaths) {
      expect(
        lineCount(source(path)),
        `${path} excedeu o orçamento de responsabilidade`
      ).toBeLessThanOrEqual(360);
    }
  });
});
