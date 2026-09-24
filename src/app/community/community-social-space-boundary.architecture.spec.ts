// src/app/community/community-social-space-boundary.architecture.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getSocialSpaceDefinition,
  hasSocialSpaceCapability,
} from '../core/domain/social-space.definition';
import {
  getCommunitySocialSpaceAdapter,
} from './presentation/community-social-space.adapter';

const COMMUNITY_ROOT = resolve(process.cwd(), 'src/app/community');

function productionComponentFiles(root: string): readonly string[] {
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
        && (entry.name.endsWith('.component.ts')
          || entry.name.endsWith('.component.html'))
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
    expect(hasSocialSpaceCapability('room', 'personalMembershipHub')).toBe(false);
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

  it('impede branching literal Community/Venue de voltar aos components', () => {
    const forbidden = [
      /source\.type\s*===\s*['"](?:community|venue)['"]/u,
      /source\.type\s*!==\s*['"](?:community|venue)['"]/u,
      /sourceType\(\)\s*===\s*['"](?:community|venue)['"]/u,
      /sourceType\(\)\s*!==\s*['"](?:community|venue)['"]/u,
      /sourceType\s*===\s*['"](?:community|venue)['"]/u,
      /sourceType\s*!==\s*['"](?:community|venue)['"]/u,
    ] as const;

    for (const file of productionComponentFiles(COMMUNITY_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const displayPath = relative(process.cwd(), file);

      for (const pattern of forbidden) {
        expect(
          pattern.test(source),
          `${displayPath} voltou a decidir produto por discriminante literal; use social-space adapter/capabilities`
        ).toBe(false);
      }

      expect(
        source.includes('official_space'),
        `${displayPath} vazou alias legado official_space para UI`
      ).toBe(false);
    }
  });
});
