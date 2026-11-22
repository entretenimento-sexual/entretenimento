import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGISTRATION_FLOW_VERSION } from '../auth/user-registration-seed';
import {
  assessRegistrationAbandonment,
  classifyRegistrationDraft,
  nextRegistrationAbandonment,
  REGISTRATION_RESUME_WINDOW_MS,
} from './registration-abandonment.policy';

const now = Date.UTC(2026, 10, 21);
const day = 86_400_000;
const uid = 'sample-registration';
const createdAt = now - 35 * day;
const authProgress = { stage: 'credentialsReady', observedAtMs: createdAt };
const account = {
  uid, createdAt, profileCompleted: false, accountStatus: 'active', loginAllowed: true,
  interactionBlocked: true, publicVisibility: 'hidden', registrationFlowVersion: REGISTRATION_FLOW_VERSION,
  registrationAuthProgress: authProgress,
};
const auth = {
  uid, email: 'sample@example.test', emailVerified: true,
  disabled: false,
  metadata: {
    creationTime: new Date(createdAt).toUTCString(),
    lastSignInTime: new Date(createdAt).toUTCString(),
    lastRefreshTime: new Date(now).toUTCString(),
  },
};

test('o aceite antigo exige a etapa de Termos e refresh de token não reinicia o prazo', () => {
  const pending = assessRegistrationAbandonment(uid, {
    ...account, acceptedTerms: { accepted: true, version: 'v2', acceptedAt: createdAt },
  }, auth, undefined, false, now);
  assert.deepEqual(pending, { kind: 'candidate', stage: 'termsPending', activityAtMs: createdAt, authProgress });
  const resumed = assessRegistrationAbandonment(uid, account, {
    ...auth, metadata: { ...auth.metadata, lastSignInTime: new Date(now - day).toUTCString() },
  }, undefined, false, now);
  assert.equal(resumed.kind, 'active');
});

test('confirmação de e-mail desloca o relógio de uma conta antiga sem novo login', () => {
  const before = {
    ...account, registrationAuthProgress: { stage: 'emailPending', observedAtMs: createdAt },
  };
  const marker = nextRegistrationAbandonment(
    assessRegistrationAbandonment(uid, before, { ...auth, emailVerified: false }, undefined, false, now - day),
    undefined, now - day,
  );
  const advanced = assessRegistrationAbandonment(uid, before, auth, undefined, false, now);
  const progress = { stage: 'credentialsReady', observedAtMs: now };
  assert.deepEqual(advanced, { kind: 'active', stage: 'termsPending', activityAtMs: now, authProgress: progress });
  assert.equal(nextRegistrationAbandonment(advanced, marker, now), undefined);
  const saved = { ...account, registrationAuthProgress: progress };
  assert.equal(assessRegistrationAbandonment(uid, saved, auth, undefined, false, now + 29 * day).kind, 'active');
  assert.deepEqual(assessRegistrationAbandonment(uid, saved, auth, undefined, false, now + 30 * day), {
    kind: 'candidate', stage: 'termsPending', activityAtMs: now, authProgress: progress,
  });
});

test('senha da prévia abre um novo prazo mesmo para conta antiga', () => {
  const previewUid = 'email-link-preview-fixture';
  const before = {
    ...account, uid: previewUid,
    registrationAuthProgress: { stage: 'passwordPending', observedAtMs: createdAt },
  };
  const previewAuth = { ...auth, uid: previewUid };
  assert.equal(assessRegistrationAbandonment(previewUid, before, previewAuth, undefined, false, now).kind, 'candidate');
  assert.deepEqual(assessRegistrationAbandonment(previewUid, before, {
    ...previewAuth, passwordHash: 'fixture',
  }, undefined, false, now), {
    kind: 'active', stage: 'termsPending', activityAtMs: now,
    authProgress: { stage: 'credentialsReady', observedAtMs: now },
  });
});

test('inicializa conta antiga sem marco e preserva prazo já observado para a mesma etapa', () => {
  const legacy = { ...account, registrationAuthProgress: undefined };
  assert.equal(assessRegistrationAbandonment(uid, legacy, auth, undefined, false, now).kind, 'active');
  const marker = nextRegistrationAbandonment(
    assessRegistrationAbandonment(uid, account, auth, undefined, false, now - day), undefined, now - day,
  );
  const assessment = assessRegistrationAbandonment(uid, {
    ...legacy, registrationAbandonment: marker,
  }, auth, undefined, false, now);
  assert.deepEqual(assessment, { kind: 'candidate', stage: 'termsPending', activityAtMs: createdAt, authProgress });
  assert.equal(nextRegistrationAbandonment(assessment, marker, now), marker);
});

test('espera a janela inteira, preserva o prazo no retry e encerra marca ao retomar', () => {
  const assessment = assessRegistrationAbandonment(uid, account, auth, undefined, false, now);
  const marker = nextRegistrationAbandonment(assessment, undefined, now);
  assert.equal(marker?.status, 'resume_window');
  assert.equal(nextRegistrationAbandonment(assessment, marker, now + day), marker);
  assert.equal(nextRegistrationAbandonment(assessment, marker, now + REGISTRATION_RESUME_WINDOW_MS)?.status,
    'review_ready');
  assert.equal(nextRegistrationAbandonment({ kind: 'protected' }, marker, now), undefined);
});

test('preserva recibos vinculados e registros com datas inconclusivas', () => {
  const draft = 'aabbccdd-2211-4123-a123-0123456789ab';
  assert.equal(classifyRegistrationDraft(draft, { expiresAtMs: now }, now), 'expiredDrafts');
  assert.equal(classifyRegistrationDraft(draft, { expiresAtMs: now, oobCodeHash: 'receipt' }, now), 'accountReceipts');
  assert.equal(assessRegistrationAbandonment(uid, {
    ...account, createdAt: undefined,
  }, auth, undefined, false, now).kind, 'unclassified');
  assert.equal(assessRegistrationAbandonment(uid, account, auth, {
    uid, status: 'REVIEW_REQUIRED',
  }, false, now).kind, 'protected');
});
