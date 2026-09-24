import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  COMMUNITY_TOPICS_PRODUCT_STATE,
  assertCommunityTopicsProductAvailable,
} from './community-topics-product-state';

const COMMUNITY_SOURCE = path.resolve(__dirname, '../../src/community');

const TOPIC_HANDLERS = Object.freeze([
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

test('Discussões permanecem em estado de produto active', () => {
  assert.equal(COMMUNITY_TOPICS_PRODUCT_STATE, 'active');
  assert.doesNotThrow(() => assertCommunityTopicsProductAvailable());
});

test('todas as seis callables aplicam o estado de produto antes de qualquer acesso Firestore', () => {
  let guardedCallableCount = 0;

  for (const contract of TOPIC_HANDLERS) {
    const source = readFileSync(
      path.join(COMMUNITY_SOURCE, contract.file),
      'utf8'
    );

    assert.match(source, /isCommunityPreviewRuntimeAvailable\(\)/);

    for (const callable of contract.callables) {
      const exportIndex = source.indexOf(`export const ${callable}`);
      assert.ok(exportIndex >= 0, `${callable} não encontrada`);

      const nextExportIndex = source.indexOf('export const ', exportIndex + 1);
      const body = source.slice(
        exportIndex,
        nextExportIndex >= 0 ? nextExportIndex : source.length
      );
      const runtimeGuardIndex = body.indexOf('assertTopicsRuntime();');
      const productGuardIndex = body.indexOf(
        'assertCommunityTopicsProductAvailable();'
      );
      const firestoreIndex = body.indexOf('db.');

      assert.ok(
        runtimeGuardIndex >= 0,
        `${callable} não chama o runtime guard de Comunidades`
      );
      assert.ok(
        productGuardIndex > runtimeGuardIndex,
        `${callable} deve aplicar o estado de produto depois do runtime guard`
      );
      assert.ok(
        firestoreIndex < 0 || productGuardIndex < firestoreIndex,
        `${callable} acessa Firestore antes do gate de produto`
      );

      guardedCallableCount += 1;
    }
  }

  assert.equal(guardedCallableCount, 6);
});
