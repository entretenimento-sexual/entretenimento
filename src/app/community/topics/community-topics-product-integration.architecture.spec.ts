import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP_ROOT = resolve(ROOT, 'src/app');
const TOPICS_ROOT_FRAGMENT = '/community/topics/';
const TOPIC_REPOSITORY_PATH =
  '/community/data-access/community-topic.repository.ts';
const PREVIEW_COMPONENT_PATH =
  '/community/preview/community-preview-page.component.ts';

function productionFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    const stat = statSync(path);

    if (stat.isDirectory()) return productionFiles(path);
    if (!/\.(ts|html)$/.test(path)) return [];
    if (/\.(spec|test)\.ts$/.test(path)) return [];
    return [path];
  });
}

describe('Community Discussions product integration', () => {
  it('conecta Discussões somente pela superfície canônica de preview', () => {
    const integrations: string[] = [];

    for (const file of productionFiles(APP_ROOT)) {
      const normalized = file.replaceAll('\\', '/');
      if (
        normalized.includes(TOPICS_ROOT_FRAGMENT)
        || normalized.endsWith(TOPIC_REPOSITORY_PATH)
      ) {
        continue;
      }

      const source = readFileSync(file, 'utf8');
      if (
        source.includes('CommunityTopicsComponent')
        || source.includes('<app-community-topics')
      ) {
        integrations.push(normalized);
      }
    }

    expect(integrations).toHaveLength(2);
    expect(
      integrations.every((path) =>
        path.endsWith(PREVIEW_COMPONENT_PATH)
        || path.endsWith('/community/preview/community-preview-page.component.html')
      )
    ).toBe(true);
  });

  it('mantém Discussões exclusiva de Comunidades e separada de Locais', () => {
    const previewTemplate = readFileSync(
      resolve(
        APP_ROOT,
        'community/preview/community-preview-page.component.html'
      ),
      'utf8'
    );

    expect(previewTemplate).toContain('community-tab-topics');
    expect(previewTemplate).toContain('<app-community-topics');
    expect(previewTemplate).toMatch(
      /spaceCapabilities\(preview\.community\)\.topics[\s\S]{0,700}?community-tab-topics/
    );
    expect(previewTemplate).toMatch(
      /activeSection\(\) === 'topics'[\s\S]{0,350}?spaceCapabilities\(preview\.community\)\.topics/
    );
  });

  it('mantém o produto backend explicitamente ativo e com gate canônico', () => {
    const productState = readFileSync(
      resolve(
        ROOT,
        'functions/src/community/community-topics-product-state.ts'
      ),
      'utf8'
    );

    expect(productState).toContain(
      "COMMUNITY_TOPICS_PRODUCT_STATE = 'active'"
    );
    expect(productState).toContain(
      'assertCommunityTopicsProductAvailable'
    );
    expect(productState).not.toContain(
      'community_topics_product_frozen'
    );
  });
});
