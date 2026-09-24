// src/app/community/community-social-space-boundary.architecture.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getSocialSpaceDefinition,
} from '../core/domain/social-space.definition';
import {
  getCommunitySocialSpaceAdapter,
} from './presentation/community-social-space.adapter';

const COMMUNITY_ROOT = resolve(process.cwd(), 'src/app/community');

function productionFiles(root: string): readonly string[] {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }

      if (
        entry.isFile()
        && (entry.name.endsWith('.ts') || entry.name.endsWith('.html'))
        && !entry.name.endsWith('.spec.ts')
        && !entry.name.endsWith('.test.ts')
      ) {
        files.push(absolute);
      }
    }
  };

  visit(root);
  return files;
}

describe('Community × Local social-space boundary', () => {
  it('mantém o adapter de produto bounded', () => {
    const adapterSource = readFileSync(
      resolve(
        COMMUNITY_ROOT,
        'presentation/community-social-space.adapter.ts'
      ),
      'utf8'
    );

    expect(adapterSource.split(/\r?\n/u).length).toBeLessThanOrEqual(450);
  });

  it('mantém capacidades no kernel comum sem reativar Room', () => {
    expect(getSocialSpaceDefinition('community').capabilities).toMatchObject({
      topics: true,
      memberDirectory: true,
      managedLifecycle: true,
      capacityManagement: true,
      interestDiscovery: true,
      personalMembershipHub: true,
    });
    expect(getSocialSpaceDefinition('venue').capabilities).toMatchObject({
      publicLocation: true,
      topics: false,
      memberDirectory: false,
      managedLifecycle: false,
      capacityManagement: false,
      interestDiscovery: false,
      personalMembershipHub: false,
    });
    expect(getSocialSpaceDefinition('room').capabilities).toMatchObject({
      topics: false,
      memberDirectory: false,
      managedLifecycle: false,
      capacityManagement: false,
      contentModeration: false,
    });
    expect(
      getSocialSpaceDefinition('room').capabilities.personalMembershipHub
    ).toBe(false);
  });

  it('mantém copy e navegação Community/Venue nos adapters de produto', () => {
    const community = getCommunitySocialSpaceAdapter('community');
    const venue = getCommunitySocialSpaceAdapter('venue');

    expect(community.discovery.canCreateCommunity).toBe(true);
    expect(community.discovery.canCreateVenue).toBe(false);
    expect(community.membership.actionLabel('open')).toBe('Participar');

    expect(venue.discovery.canCreateCommunity).toBe(false);
    expect(venue.discovery.canCreateVenue).toBe(true);
    expect(venue.membership.actionLabel('open')).toBe('Seguir');
  });

  it('limita branching Community/Venue às fronteiras canônicas', () => {
    const forbidden = [
      /source\.type\s*===\s*['"](?:community|venue)['"]/u,
      /source\.type\s*!==\s*['"](?:community|venue)['"]/u,
      /sourceType\(\)\s*===\s*['"](?:community|venue)['"]/u,
      /sourceType\(\)\s*!==\s*['"](?:community|venue)['"]/u,
      /sourceType\s*===\s*['"](?:community|venue)['"]/u,
      /sourceType\s*!==\s*['"](?:community|venue)['"]/u,
    ] as const;

    const allowedBranching = new Set([
      'src/app/community/data-access/community-preview.model.ts',
      'src/app/community/presentation/community-social-space.adapter.ts',
    ]);
    const violations: string[] = [];

    for (const file of productionFiles(COMMUNITY_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const displayPath = relative(process.cwd(), file).replaceAll('\\', '/');

      if (
        !allowedBranching.has(displayPath)
        && forbidden.some((pattern) => pattern.test(source))
      ) {
        violations.push(
          `${displayPath} decide produto fora de adapter/normalização canônicos`
        );
      }

      if (source.includes('official_space')) {
        violations.push(
          `${displayPath} vazou alias legado official_space para frontend`
        );
      }
    }

    expect(
      violations,
      'Código de produção deve consumir social-space adapter/capabilities'
    ).toEqual([]);
  });
});
