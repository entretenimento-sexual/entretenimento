import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { environment as prodEnvironment } from '../../../../environments/environment.prod';
import { environment as stagingEnvironment } from '../../../../environments/environment.staging';

describe('Community product rollout', () => {
  it('habilita Comunidades em staging e produção sem liberar o preview de Locais', () => {
    expect(stagingEnvironment.features?.communitiesEnabled).toBe(true);
    expect(prodEnvironment.features?.communitiesEnabled).toBe(true);

    expect(stagingEnvironment.features?.communityPreview).toBe(false);
    expect(prodEnvironment.features?.communityPreview).toBe(false);
  });

  it('mantém Comunidades e Locais em flags independentes no dashboard', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/dashboard/dashboard-routing.module.ts'),
      'utf8'
    );

    const communitiesStart = source.indexOf("path: 'comunidades'");
    const venuesStart = source.indexOf("path: 'locais'", communitiesStart);

    expect(communitiesStart).toBeGreaterThanOrEqual(0);
    expect(venuesStart).toBeGreaterThan(communitiesStart);

    const communitiesBlock = source.slice(communitiesStart, venuesStart);
    const venuesBlock = source.slice(venuesStart);

    expect(communitiesBlock).toContain(
      "requireFeatureFlag('communitiesEnabled')"
    );
    expect(communitiesBlock).not.toContain(
      "requireFeatureFlag('communityPreview')"
    );
    expect(venuesBlock).toContain(
      "requireFeatureFlag('communityPreview')"
    );
  });
});
