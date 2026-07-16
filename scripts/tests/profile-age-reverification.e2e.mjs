import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
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
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const WAIT_TIMEOUT_MS = 20_000;
const WAIT_INTERVAL_MS = 150;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(label, readValue, predicate) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await readValue();

    if (predicate(lastValue)) {
      return lastValue;
    }

    await delay(WAIT_INTERVAL_MS);
  }

  throw new Error(`Timeout aguardando ${label}: ${JSON.stringify(lastValue)}`);
}

async function expectCallableFailure(callable, payload) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A Callable deveria rejeitar a operação.');
    return;
  }

  assert.fail('A Callable aceitou uma operação que deveria ser rejeitada.');
}

function createClientApp(name) {
  const app = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    name
  );
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');

  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  return { app, auth, functions };
}

function userDocument(uid, nickname) {
  return {
    uid,
    email: `${uid}@example.test`,
    nickname,
    nicknameNormalized: nickname.toLowerCase().replace(/\s+/g, '-'),
    role: 'free',
    tier: 'free',
    emailVerified: true,
    profileCompleted: true,
    accountStatus: 'active',
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    suspended: false,
    initialAdultConsentRequired: false,
    registrationFlowVersion: 'v2',
    registrationCompletedAt: Date.now(),
    adultConsent: {
      accepted: true,
      version: 'v1',
      acceptedAt: Date.now(),
    },
    acceptedTerms: {
      accepted: true,
      version: 'v1',
      acceptedAt: Date.now(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function readData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const targetClient = createClientApp(`age-target-${runId}`);
  const reporterClient = createClientApp(`age-reporter-${runId}`);
  const moderatorClient = createClientApp(`age-admin-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `age-admin-sdk-${runId}`
  );
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  const users = [];
  let targetUid = '';
  let reporterUid = '';
  let moderatorUid = '';

  try {
    const credentials = await Promise.all([
      createUserWithEmailAndPassword(
        targetClient.auth,
        `age-target-${runId}@example.test`,
        `Target-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        reporterClient.auth,
        `age-reporter-${runId}@example.test`,
        `Reporter-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        moderatorClient.auth,
        `age-admin-${runId}@example.test`,
        `Admin-${runId}-Aa1!`
      ),
    ]);

    users.push(...credentials.map((credential) => credential.user));
    targetUid = credentials[0].user.uid;
    reporterUid = credentials[1].user.uid;
    moderatorUid = credentials[2].user.uid;

    await Promise.all([
      adminAuth.updateUser(targetUid, { emailVerified: true }),
      adminAuth.setCustomUserClaims(moderatorUid, { admin: true }),
    ]);
    await Promise.all([
      credentials[0].user.getIdToken(true),
      credentials[2].user.getIdToken(true),
    ]);

    const targetUserRef = db.doc(`users/${targetUid}`);
    const targetPublicProfileRef = db.doc(`public_profiles/${targetUid}`);
    const nicknameIndexId = `nickname:perfil-${runId}`;
    const nicknameIndexRef = db.doc(`public_index/${nicknameIndexId}`);

    await Promise.all([
      targetUserRef.set({
        ...userDocument(targetUid, `Perfil ${runId}`),
        nicknameNormalized: `perfil-${runId}`,
      }, { merge: true }),
      db.doc(`users/${reporterUid}`).set(
        userDocument(reporterUid, `Reporter ${runId}`),
        { merge: true }
      ),
      db.doc(`users/${moderatorUid}`).set(
        userDocument(moderatorUid, `Admin ${runId}`),
        { merge: true }
      ),
      targetPublicProfileRef.set({
        uid: targetUid,
        nickname: `Perfil ${runId}`,
        nicknameNormalized: `perfil-${runId}`,
        role: 'free',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      nicknameIndexRef.set({
        uid: targetUid,
        type: 'nickname',
        value: `perfil-${runId}`,
        createdAt: Date.now(),
        lastChangedAt: Date.now(),
      }),
    ]);

    const reportAsReporter = httpsCallable(
      reporterClient.functions,
      'reportProfileMinorSafety'
    );
    const reportAsTarget = httpsCallable(
      targetClient.functions,
      'reportProfileMinorSafety'
    );
    const requestAsReporter = httpsCallable(
      reporterClient.functions,
      'requestProfileAgeReverification'
    );
    const requestAsAdmin = httpsCallable(
      moderatorClient.functions,
      'requestProfileAgeReverification'
    );
    const submitAsTarget = httpsCallable(
      targetClient.functions,
      'submitProfileAgeReverification'
    );
    const reviewAsAdmin = httpsCallable(
      moderatorClient.functions,
      'reviewProfileAgeReverification'
    );

    await expectCallableFailure(reportAsTarget, {
      targetUid,
      details: 'Autodenúncia deve ser bloqueada.',
    });

    const firstReport = await reportAsReporter({
      targetUid,
      details: 'Suspeita encaminhada para análise sem bloqueio automático.',
      route: `/outro-perfil/${targetUid}`,
    });
    const firstReportId = firstReport.data.reportId;
    const firstReportRef = db.doc(`moderation_reports/${firstReportId}`);

    await expectCallableFailure(reportAsReporter, {
      targetUid,
      details: 'Denúncia duplicada deve ser bloqueada.',
    });

    const stateBeforeAdmin = await readData(targetUserRef);
    assert.equal(stateBeforeAdmin.publicVisibility, 'visible');
    assert.equal(stateBeforeAdmin.interactionBlocked, false);
    assert.equal((await readData(targetPublicProfileRef))?.uid, targetUid);

    await expectCallableFailure(requestAsReporter, {
      reportId: firstReportId,
      resolution: 'Usuário comum não pode solicitar revalidação.',
    });

    await requestAsAdmin({
      reportId: firstReportId,
      resolution: 'Indícios suficientes para solicitar revalidação de idade.',
    });

    const requiredState = await waitFor(
      'revalidação obrigatória ocultar perfil',
      async () => ({
        user: await readData(targetUserRef),
        report: await readData(firstReportRef),
        publicProfile: await readData(targetPublicProfileRef),
        nicknameIndex: await readData(nicknameIndexRef),
      }),
      (state) =>
        state.user?.ageReverification?.status === 'REQUIRED' &&
        state.user?.publicVisibility === 'hidden' &&
        state.user?.interactionBlocked === true &&
        state.report?.ageReverificationStatus === 'REQUIRED' &&
        state.publicProfile === null &&
        state.nicknameIndex === null
    );
    const firstCaseId = requiredState.user.ageReverification.caseId;
    const firstCaseRef = db.doc(
      `age_reverification_cases/${firstCaseId}`
    );

    await submitAsTarget({
      birthDate: '2000-01-01',
      confirmsTruthfulness: true,
      acceptsRestrictedProcessing: true,
    });

    const submittedState = await waitFor(
      'revalidação adulta ser enviada',
      async () => ({
        user: await readData(targetUserRef),
        ageCase: await readData(firstCaseRef),
      }),
      (state) =>
        state.user?.ageReverification?.status === 'SUBMITTED' &&
        state.ageCase?.status === 'SUBMITTED'
    );
    assert.equal(submittedState.ageCase.birthDateStored, false);
    assert.equal('birthDate' in submittedState.ageCase, false);
    assert.equal(
      'birthDate' in submittedState.user.ageReverification,
      false
    );

    await reviewAsAdmin({
      reportId: firstReportId,
      decision: 'VERIFY',
      resolution: 'Maioridade confirmada após revisão administrativa.',
    });

    await waitFor(
      'maioridade confirmada restaurar perfil',
      async () => ({
        user: await readData(targetUserRef),
        report: await readData(firstReportRef),
        publicProfile: await readData(targetPublicProfileRef),
      }),
      (state) =>
        state.user?.ageReverification?.status === 'VERIFIED' &&
        state.user?.publicVisibility === 'visible' &&
        state.user?.interactionBlocked === false &&
        state.report?.status === 'resolved' &&
        state.report?.moderationAction === 'KEEP' &&
        state.publicProfile?.uid === targetUid
    );

    const secondReport = await reportAsReporter({
      targetUid,
      details: 'Segundo caso para validar declaração abaixo de 18 anos.',
    });
    const secondReportId = secondReport.data.reportId;
    const secondReportRef = db.doc(`moderation_reports/${secondReportId}`);

    await requestAsAdmin({
      reportId: secondReportId,
      resolution: 'Nova análise solicitada após denúncia específica de perfil.',
    });
    await submitAsTarget({
      birthDate: '2015-01-01',
      confirmsTruthfulness: true,
      acceptsRestrictedProcessing: true,
    });

    await expectCallableFailure(reviewAsAdmin, {
      reportId: secondReportId,
      decision: 'VERIFY',
      resolution: 'Esta aprovação deve ser bloqueada pelo backend.',
    });

    await reviewAsAdmin({
      reportId: secondReportId,
      decision: 'REJECT',
      resolution: 'Menoridade confirmada pela declaração enviada no caso.',
    });

    await waitFor(
      'menoridade confirmada suspender conta',
      async () => ({
        user: await readData(targetUserRef),
        report: await readData(secondReportRef),
        publicProfile: await readData(targetPublicProfileRef),
      }),
      (state) =>
        state.user?.ageReverification?.status === 'REJECTED' &&
        state.user?.accountStatus === 'moderation_suspended' &&
        state.user?.suspended === true &&
        state.report?.moderationAction === 'REMOVE' &&
        state.publicProfile === null
    );

    console.log('✔ autodenúncia, duplicidade e decisão por usuário comum bloqueadas');
    console.log('✔ denúncia isolada não restringiu a conta');
    console.log('✔ moderação solicitou revalidação apenas para perfil/minor_safety');
    console.log('✔ data de nascimento não foi persistida');
    console.log('✔ maioridade confirmada restaurou perfil e interações');
    console.log('✔ declaração abaixo de 18 anos não pôde ser aprovada como adulta');
    console.log('✔ menoridade confirmada suspendeu a conta após decisão administrativa');
  } finally {
    const cleanupTasks = [];

    for (const user of users) {
      cleanupTasks.push(
        deleteUser(user).catch(() => undefined)
      );
    }

    await Promise.allSettled(cleanupTasks);
    await Promise.allSettled([
      deleteClientApp(targetClient.app),
      deleteClientApp(reporterClient.app),
      deleteClientApp(moderatorClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

run().catch((error) => {
  console.error('Falha no E2E de revalidação de idade do perfil.', error);
  process.exitCode = 1;
});
