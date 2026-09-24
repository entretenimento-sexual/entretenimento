import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  COMMUNITY_TOPICS_PRODUCT_STATE,
  assertCommunityTopicsProductAvailable,
} from './community-topics-product-state';

const COMMUNITY_SOURCE = path.resolve(__dirname, '../../src/community');

const FROZEN_HANDLERS = Object.freeze([
  {
    file: 'get-community-topics-page.handler.ts',
    callables: ['getCommunityTopicsPage'],
  },
  {
    file: 'get-community-topic-detail.handler.ts',
    callables: [
      'getCommunityTopicDetail',
      'getCommunityTopicRepliesPage',
    ],
  },
  {
    file: 'community-topic-write.handler.ts',
    callables: [
      'createCommunityTopic',
      'createCommunityTopicReply',
    ],
  },
  {
    file: 'community-topic-moderation.handler.ts',
    callables: ['moderateCommunityTopic'],
  },
]);

test('Tópicos permanecem em estado de produto frozen', () => {
  assert.equal(COMMUNITY_TOPICS_PRODUCT_STATE, 'frozen');

  assert.throws(
    () => assertCommunityTopicsProductAvailable(),
    (error: unknown) => {
      const source = error as {
        code?: unknown;
        details?: Record<string, unknown>;
      };
      assert.equal(source.code, 'failed-precondition');
      assert.equal(
        source.details?.['reason'],
        'community_topics_product_frozen'
      );
      assert.equal(
        source.details?.['recommendedAction'],
        'use_community_mural'
      );
      return true;
    }
  );
});

test('todas as seis callables são bloqueadas antes de qualquer acesso Firestore', () => {
  let guardedCallableCount = 0;

  for (const contract of FROZEN_HANDLERS) {
    const source = readFileSync(
      path.join(COMMUNITY_SOURCE, contract.file),
      'utf8'
    );

    assert.doesNotMatch(source, /isCommunityPreviewRuntimeAvailable/);

    for (const callable of contract.callables) {
      const exportIndex = source.indexOf(`export const ${callable}`);
      assert.ok(exportIndex >= 0, `${callable} não encontrada`);

      const nextExportIndex = source.indexOf('export const ', exportIndex + 1);
      const body = source.slice(
        exportIndex,
        nextExportIndex >= 0 ? nextExportIndex : source.length
      );
      const guardIndex = body.indexOf(
        'assertCommunityTopicsProductAvailable();'
      );
      const firestoreIndex = body.indexOf('db.');

      assert.ok(
        guardIndex >= 0,
        `${callable} não chama o gate de produto frozen`
      );
      assert.ok(
        firestoreIndex < 0 || guardIndex < firestoreIndex,
        `${callable} acessa Firestore antes do gate frozen`
      );

      guardedCallableCount += 1;
    }
  }

  assert.equal(guardedCallableCount, 6);
});
