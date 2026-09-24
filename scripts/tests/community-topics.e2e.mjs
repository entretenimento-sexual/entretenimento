import assert from 'node:assert/strict';

import {
  deleteApp,
  initializeApp,
} from 'firebase/app';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const FUNCTIONS_PORT = 15001;

async function expectFrozen(callable, payload = {}) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A callable deveria rejeitar Tópicos congelados.');
    assert.equal(error.code, 'functions/failed-precondition');
    assert.equal(
      error.details?.reason,
      'community_topics_product_frozen'
    );
    assert.equal(
      error.details?.recommendedAction,
      'use_community_mural'
    );
    return;
  }

  assert.fail('A callable de Tópicos aceitou operação durante o freeze.');
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const app = initializeApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    'community-topics-frozen-e2e'
  );
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  try {
    const contracts = [
      ['getCommunityTopicsPage', { communityId: 'community-frozen', limit: 12 }],
      ['getCommunityTopicDetail', {
        communityId: 'community-frozen',
        topicId: 'topic-frozen',
      }],
      ['getCommunityTopicRepliesPage', {
        communityId: 'community-frozen',
        topicId: 'topic-frozen',
        limit: 20,
      }],
      ['createCommunityTopic', {
        requestId: 'topic-create-frozen',
        communityId: 'community-frozen',
        title: 'Não deve ser criada',
        body: 'O domínio está congelado.',
      }],
      ['createCommunityTopicReply', {
        requestId: 'topic-reply-frozen',
        communityId: 'community-frozen',
        topicId: 'topic-frozen',
        body: 'Não deve ser criada.',
      }],
      ['moderateCommunityTopic', {
        requestId: 'topic-moderation-frozen',
        communityId: 'community-frozen',
        topicId: 'topic-frozen',
        action: 'lock',
        reason: 'Domínio congelado.',
      }],
    ];

    for (const [name, payload] of contracts) {
      await expectFrozen(
        httpsCallable(functions, name),
        payload
      );
    }

    console.log(
      '[community-topics:e2e] As seis callables permanecem congeladas e orientam uso do Mural.'
    );
  } finally {
    await deleteApp(app);
  }
}

run().catch((error) => {
  console.error(
    '[community-topics:e2e] Falha ao validar o freeze de Tópicos.',
    error
  );
  process.exitCode = 1;
});
