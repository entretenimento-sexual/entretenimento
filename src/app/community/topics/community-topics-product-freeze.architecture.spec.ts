import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');
const TOPICS_ROOT_FRAGMENT = '/community/topics/';
const TOPIC_REPOSITORY_PATH =
  '/community/data-access/community-topic.repository.ts';

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

describe('Community Topics product freeze', () => {
  it('não conecta Discussões a nenhuma superfície de produção', () => {
    const violations: string[] = [];

    for (const file of productionFiles(APP_ROOT)) {
      const normalized = file.replaceAll('\\', '/');
      if (
        normalized.includes(TOPICS_ROOT_FRAGMENT)
        || normalized.endsWith(TOPIC_REPOSITORY_PATH)
      ) {
        continue;
      }

      const source = readFileSync(file, 'utf8');

      for (const forbidden of [
        'CommunityTopicsComponent',
        '<app-community-topics',
        'CommunityTopicRepository',
      ]) {
        if (source.includes(forbidden)) {
          violations.push(`${normalized}: ${forbidden}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('mantém o preview canônico sem aba de Discussões', () => {
    const previewTemplate = readFileSync(
      resolve(
        APP_ROOT,
        'community/preview/community-preview-page.component.html'
      ),
      'utf8'
    );

    expect(previewTemplate).toContain('Mural');
    expect(previewTemplate).toContain('Fotos');
    expect(previewTemplate).toContain('Membros');
    expect(previewTemplate).toContain('Sobre');
    expect(previewTemplate).not.toContain('app-community-topics');
    expect(previewTemplate).not.toContain('community-tab-topics');
  });
});
