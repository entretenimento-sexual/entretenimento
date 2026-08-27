import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  applicationDefault,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

function projection(communityId, rankScore, tagIds) {
  return {
    communityId,
    name: `Comunidade ${communityId.slice(-6)}`,
    slug: `comunidade-${communityId.slice(-6).toLowerCase()}`,
    description: 'Projeção E2E para filtro de interesses.',
    source: { type: 'community', id: communityId },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    tagIds,
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      interaction: 'members_only',
      contentAccess: {
        minimumRole: null,
        requiresActiveSubscription: false,
      },
    },
    rankScore,
    updatedAt: rankScore,
  };
}

async function expectCallableFailure(callable, payload, expectedCode) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A Callable deveria rejeitar a operação.');
    assert.equal(error.code, `functions/${expectedCode}`);
    return;
  }

  assert.fail('A Callable aceitou um filtro que deveria ser rejeitado.');
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const clientApp = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `community-tags-client-${runId}`
  );
  const auth = getAuth(clientApp);
  const functions = getFunctions(clientApp, 'us-central1');
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    },
    `community-tags-admin-${runId}`
  );
  const adminAuth = getAdminAuth(adminApp);
  const db = getFirestore(adminApp);
  const email = `community-tags-${runId}@example.test`;
  let uid = '';

  const matchedHighId = `community-tag-high-${runId}`;
  const matchedLowId = `community-tag-low-${runId}`;
  const otherId = `community-tag-other-${runId}`;
  const refs = [matchedHighId, matchedLowId, otherId].map((id) =>
    db.doc(`community_discovery_index/${id}`)
  );

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      `TagFilter-${runId}-Aa1!`
    );
    uid = credential.user.uid;
    await adminAuth.updateUser(uid, { emailVerified: true });
    await credential.user.getIdToken(true);

    await Promise.all([
      refs[0].set(projection(
        matchedHighId,
        300,
        ['intent:friendship', 'audience:couple_mf']
      )),
      refs[1].set(projection(
        matchedLowId,
        200,
        ['intent:friendship', 'practice:bdsm']
      )),
      refs[2].set(projection(
        otherId,
        400,
        ['practice:bdsm']
      )),
    ]);

    const getDiscovery = httpsCallable(functions, 'getCommunityDiscoveryPage');
    const filtered = await getDiscovery({
      sourceType: 'community',
      tagId: 'intent:friendship',
      limit: 12,
    });

    assert.deepEqual(
      filtered.data.items.map((item) => item.communityId),
      [matchedHighId, matchedLowId],
      'O filtro deve preservar a ordenação por rankScore entre os resultados compatíveis.'
    );
    assert.equal(
      filtered.data.items.some((item) => item.communityId === otherId),
      false,
      'Comunidade sem a tag selecionada não pode aparecer no resultado filtrado.'
    );
    assert.deepEqual(
      filtered.data.items[0].tags.map((tag) => tag.id),
      ['intent:friendship', 'audience:couple_mf']
    );
    assert.equal(
      'tagIds' in filtered.data.items[0],
      false,
      'O card público deve expor tags sanitizadas, não o campo bruto da projeção.'
    );

    await expectCallableFailure(
      getDiscovery,
      {
        sourceType: 'community',
        tagId: 'practice:inexistente',
        limit: 12,
      },
      'invalid-argument'
    );

    console.log(
      '[community-discovery-tags:e2e] Filtro de Comunidades por tags validado com sucesso.'
    );
  } finally {
    await Promise.allSettled(refs.map((reference) => reference.delete()));

    if (uid) {
      await adminAuth.deleteUser(uid).catch(() => undefined);
    }

    await Promise.allSettled([
      deleteClientApp(clientApp),
      deleteAdminApp(adminApp),
    ]);
  }
}

run().catch((error) => {
  console.error('[community-discovery-tags:e2e] Falha:', error);
  process.exitCode = 1;
});
