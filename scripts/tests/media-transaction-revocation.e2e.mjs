// Real Firestore conflict/retry coverage for Media's canonical account and
// bilateral-block transaction guards. This suite NEVER uses production data,
// and deliberately requires the isolated E2E Firestore Emulator (port 18080).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const FIRESTORE_EMULATOR = '127.0.0.1:18080';
const MAX_WAIT_MS = 20_000;

if (process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_EMULATOR) {
  throw new Error(
    'Media transaction E2E exige Firestore isolado em ' + FIRESTORE_EMULATOR
  );
}
const activeProject =
  process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? PROJECT_ID;
if (activeProject !== PROJECT_ID) {
  throw new Error('Media transaction E2E recusou projeto não demonstrativo.');
}
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;

const require = createRequire(import.meta.url);
const { db } = require('../../functions/lib/firebaseApp.js');
const {
  assertPublicMediaConsumptionAccessInTransaction,
} = require('../../functions/lib/media/application/public-media-consumption-access.policy.js');
const {
  assertNoActiveBilateralBlockInTransaction,
} = require('../../functions/lib/friendship/application/bilateral-block-access.policy.js');
const {
  resolvePhotoAudienceAccessInTransaction,
} = require('../../functions/lib/media/application/photo-audience-access.policy.js');
const {
  assertCurrentPublicMediaOwnerLifecycle,
} = require('../../functions/lib/media/application/public-media-transaction-owner-access.policy.js');

const runId = randomUUID().replaceAll('-', '');
const root = db.collection('media_transaction_revocation_e2e').doc(runId);
let scenarioNumber = 0;

function admittedAccount(uid) {
  return {
    uid,
    accountStatus: 'active',
    publicVisibility: 'visible',
    suspended: false,
    accountLocked: false,
    loginAllowed: true,
    interactionBlocked: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: { accepted: true, version: 'v1' },
    // Stronger verification is assurance, never a Media access gate.
    ageEligibilityAssurance: 'SELF_DECLARED_ADULT',
  };
}

async function withTimeout(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Timeout aguardando ' + label)),
          MAX_WAIT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function createCase(label) {
  const number = ++scenarioNumber;
  const slug = String(number).padStart(2, '0');
  const ownerUid = 'media_tx_owner_' + runId + '_' + slug;
  const viewerUid = 'media_tx_viewer_' + runId + '_' + slug;
  const owner = db.doc('users/' + ownerUid);
  const viewer = db.doc('users/' + viewerUid);
  const outgoing = db.doc('users/' + viewerUid + '/blocks/' + ownerUid);
  const incoming = db.doc('users/' + ownerUid + '/blocks/' + viewerUid);
  const metric = root.collection('metrics').doc(slug);
  await Promise.all([
    owner.set(admittedAccount(ownerUid)),
    viewer.set(admittedAccount(viewerUid)),
  ]);
  return { label, ownerUid, viewerUid, owner, viewer, outgoing, incoming, metric };
}

async function assertCurrentAudience(transaction, refs, kind) {
  await assertPublicMediaConsumptionAccessInTransaction(
    transaction, refs.viewerUid
  );
  if (kind === 'photo') {
    await resolvePhotoAudienceAccessInTransaction(
      transaction,
      refs.viewerUid,
      refs.ownerUid,
      'PUBLIC',
      'Foto pública não encontrada.'
    );
  } else {
    await assertNoActiveBilateralBlockInTransaction(
      transaction,
      refs.viewerUid,
      refs.ownerUid,
      'Vídeo público não encontrado.'
    );
  }
  const ownerSnap = await transaction.get(refs.owner);
  assertCurrentPublicMediaOwnerLifecycle(
    ownerSnap.exists ? ownerSnap.data() : null
  );
}

async function assertAllowed(label, kind) {
  const refs = await createCase(label);
  await db.runTransaction(async (transaction) => {
    await assertCurrentAudience(transaction, refs, kind);
    transaction.set(refs.metric, { count: 1, scenario: label });
  }, { maxAttempts: 5 });
  assert.equal((await refs.metric.get()).data()?.count, 1);
  console.log('[media-tx:e2e] PASS allowed: ' + label);
}

async function assertDeniedAfterConcurrentChange({
  label,
  kind,
  change,
  code,
  reason,
}) {
  const refs = await createCase(label);
  let attempts = 0;
  let signalRead;
  let releaseFirstRead;
  const firstRead = new Promise((resolve) => { signalRead = resolve; });
  const resume = new Promise((resolve) => { releaseFirstRead = resolve; });

  // The transaction first passes all access checks. A competing write then
  // changes one of those read documents before the metric is committed.
  // Firestore must retry against current state, then reject without a write.
  const settled = db.runTransaction(async (transaction) => {
    attempts += 1;
    await assertCurrentAudience(transaction, refs, kind);
    if (attempts === 1) {
      signalRead();
      await resume;
    }
    transaction.set(refs.metric, { count: 1, scenario: label });
  }, { maxAttempts: 5 }).then(
    () => ({ committed: true }),
    (error) => ({ committed: false, error })
  );

  try {
    await withTimeout(
      Promise.race([
        firstRead,
        settled.then((outcome) => {
          throw outcome.error ?? new Error('Transação concluiu antes da mudança.');
        }),
      ]),
      'primeira leitura: ' + label
    );
    await change(refs);
  } finally {
    releaseFirstRead();
  }

  const outcome = await withTimeout(settled, 'reexecução: ' + label);
  assert.equal(outcome.committed, false, label + ': métrica indevida gravada');
  assert.equal(outcome.error?.code, code, label + ': código de erro');
  if (reason) {
    assert.equal(outcome.error?.details?.reason, reason, label + ': razão');
  }
  assert.ok(attempts >= 2, label + ': Firestore não reexecutou a transação');
  assert.equal((await refs.metric.get()).exists, false, label + ': métrica persistiu');
  console.log('[media-tx:e2e] PASS revoked: ' + label);
}

async function run() {
  await assertAllowed('video active viewer', 'video');
  await assertAllowed('photo active viewer', 'photo');

  const cases = [
    {
      label: 'video viewer suspended after preflight',
      kind: 'video',
      change: ({ viewer }) => viewer.update({ suspended: true }),
      code: 'failed-precondition',
      reason: 'ACCOUNT_UNAVAILABLE',
    },
    {
      label: 'photo viewer suspended after preflight',
      kind: 'photo',
      change: ({ viewer }) => viewer.update({ suspended: true }),
      code: 'failed-precondition',
      reason: 'ACCOUNT_UNAVAILABLE',
    },
    {
      label: 'video viewer locked after preflight',
      kind: 'video',
      change: ({ viewer }) => viewer.update({ accountLocked: true }),
      code: 'failed-precondition',
      reason: 'ACCOUNT_UNAVAILABLE',
    },
    {
      label: 'video owner suspended after preflight',
      kind: 'video',
      change: ({ owner }) => owner.update({ suspended: true }),
      code: 'not-found',
    },
    {
      label: 'video blocked by viewer after preflight',
      kind: 'video',
      change: ({ outgoing }) => outgoing.set({ isBlocked: true }),
      code: 'not-found',
    },
    {
      label: 'video blocked by owner after preflight',
      kind: 'video',
      change: ({ incoming }) => incoming.set({ isBlocked: true }),
      code: 'not-found',
    },
    {
      label: 'photo blocked by viewer after preflight',
      kind: 'photo',
      change: ({ outgoing }) => outgoing.set({ isBlocked: true }),
      code: 'not-found',
    },
    {
      label: 'photo blocked by owner after preflight',
      kind: 'photo',
      change: ({ incoming }) => incoming.set({ isBlocked: true }),
      code: 'not-found',
    },
    {
      label: 'video terms revoked after preflight',
      kind: 'video',
      change: ({ viewer }) => viewer.update({
        acceptedTerms: {
          accepted: true,
          version: 'outdated',
          acknowledgedPrivacyNotice: true,
        },
      }),
      code: 'failed-precondition',
      reason: 'TERMS_REQUIRED',
    },
  ];

  for (const scenario of cases) {
    await assertDeniedAfterConcurrentChange(scenario);
  }
  console.log(
    '[media-tx:e2e] PASS: ' + (cases.length + 2) +
    ' cenários, transações reais e nenhuma métrica após revogação.'
  );
}

run().then(
  async () => {
    await db.terminate();
  },
  async (error) => {
    console.error('[media-tx:e2e] FAILED', error);
    await db.terminate().catch(() => undefined);
    process.exitCode = 1;
  }
);
