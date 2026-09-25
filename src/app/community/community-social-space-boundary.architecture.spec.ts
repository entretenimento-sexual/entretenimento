// src/app/community/community-social-space-boundary.architecture.spec.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getSocialSpaceDefinition,
} from '../core/domain/social-space.definition';
import {
  getCommunitySocialSpaceAdapter,
} from './presentation/community-social-space.adapter';

const APP_ROOT = resolve(process.cwd(), 'src/app');
const COMMUNITY_ROOT = resolve(APP_ROOT, 'community');

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

function resolveTsImport(
  importer: string,
  specifier: string,
  productionTsFiles: ReadonlySet<string>
): string | null {
  let candidate: string | null = null;

  if (specifier.startsWith('.')) {
    candidate = resolve(importer, '..', specifier);
  } else if (specifier.startsWith('src/app/')) {
    candidate = resolve(process.cwd(), specifier);
  } else if (specifier.startsWith('@app/')) {
    candidate = resolve(APP_ROOT, specifier.slice('@app/'.length));
  } else if (specifier.startsWith('@core/')) {
    candidate = resolve(APP_ROOT, 'core', specifier.slice('@core/'.length));
  } else if (specifier.startsWith('@shared/')) {
    candidate = resolve(APP_ROOT, 'shared', specifier.slice('@shared/'.length));
  } else {
    return null;
  }

  for (const resolvedCandidate of [
    candidate,
    `${candidate}.ts`,
    resolve(candidate, 'index.ts'),
  ]) {
    if (productionTsFiles.has(resolvedCandidate)) {
      return resolvedCandidate;
    }
  }

  return null;
}

function productionTsInboundCounts(
  excludedImporters: ReadonlySet<string> = new Set()
): ReadonlyMap<string, number> {
  const files = productionFiles(APP_ROOT).filter((file) => file.endsWith('.ts'));
  const fileSet = new Set(files);
  const inbound = new Map<string, number>(
    files.map((file) => [file, 0] as const)
  );
  const importPattern =
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;

  for (const importer of files) {
    if (excludedImporters.has(importer)) continue;
    const source = readFileSync(importer, 'utf8');

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;

      const target = resolveTsImport(importer, specifier, fileSet);
      if (!target || target === importer) continue;
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }

  return inbound;
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

  it('não permite reintroduzir o modelo/policy duplicado de Community', () => {
    const removedLegacyPaths = [
      resolve(APP_ROOT, 'core/community/community.model.ts'),
      resolve(APP_ROOT, 'core/community/community-access-policy.ts'),
    ];

    expect(
      removedLegacyPaths.filter((file) => existsSync(file)),
      'O domínio duplicado de Community já não possui consumidores de produção'
    ).toEqual([]);
  });

  it('não permite novo consumidor frontend do callable legado de ownership', () => {
    const violations = productionFiles(APP_ROOT)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /['"]getCommunityOwnershipCandidates['"]/u.test(
          readFileSync(file, 'utf8')
        )
      )
      .map((file) => relative(process.cwd(), file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'Frontend novo deve consumir somente getCommunityOwnershipCandidatesPage'
    ).toEqual([]);
  });

  it('não permite reintroduzir FirestoreService legado sem consumidores', () => {
    const legacyFirestore = resolve(
      APP_ROOT,
      'core/services/data-handling/legacy/firestore.service.ts'
    );

    expect(existsSync(legacyFirestore)).toBe(false);
  });

  it('não introduz arquivos TS órfãos no módulo Community', () => {
    const inbound = productionTsInboundCounts();
    const orphans = [...inbound.entries()]
      .filter(([file, count]) =>
        file.startsWith(COMMUNITY_ROOT)
        && count === 0
      )
      .map(([file]) => relative(process.cwd(), file).replaceAll('\\', '/'))
      .sort();

    expect(
      orphans,
      'Arquivos sem consumidor de produção devem ser removidos ou explicitamente justificados'
    ).toEqual([]);
  });

  it('limita branching Community/Venue às fronteiras canônicas em todo frontend', () => {
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
      'src/app/core/domain/social-space.definition.ts',
    ]);
    const violations: string[] = [];

    for (const file of productionFiles(APP_ROOT)) {
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

      if (/['"]official_space['"]/u.test(source)) {
        violations.push(
          `${displayPath} tratou official_space como source type de frontend`
        );
      }
    }

    expect(
      violations,
      'Código de produção deve consumir social-space adapter/capabilities'
    ).toEqual([]);
  });
});
