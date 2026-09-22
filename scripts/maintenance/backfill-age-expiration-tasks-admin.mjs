// scripts/maintenance/backfill-age-expiration-tasks-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DE CLOUD TASKS PARA EXPIRAÇÃO ETÁRIA
// -----------------------------------------------------------------------------
// Agenda a fronteira temporal dos registros VERIFIED_ADULT finitos que já
// existiam antes do trigger scheduleAgeEligibilityExpirationTask.
//
// Segurança:
// - dry-run por padrão;
// - execução real exige AGE_EXPIRATION_TASK_APPLY=true;
// - não altera age_eligibility_records, users ou projeções públicas;
// - payload inclui updatedAtMs para que reverificações tornem tarefas antigas
//   inofensivas;
// - IDs determinísticos tornam a repetição idempotente.
//
// Execute somente depois de implantar expireAgeEligibilityAtBoundary.
//
// PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:AGE_EXPIRATION_TASK_DRY_RUN='true'
// node scripts/maintenance/backfill-age-expiration-tasks-admin.mjs
//
// Aplicação:
// $env:AGE_EXPIRATION_TASK_DRY_RUN='false'
// $env:AGE_EXPIRATION_TASK_APPLY='true'
// node scripts/maintenance/backfill-age-expiration-tasks-admin.mjs
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  FieldPath,
  getFirestore,
} from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';

const FUNCTIONS_REGION = 'us-central1';
const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();

const dryRun =
  String(process.env.AGE_EXPIRATION_TASK_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';

const apply =
  String(process.env.AGE_EXPIRATION_TASK_APPLY || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.AGE_EXPIRATION_TASK_PAGE_SIZE || '100'),
  10
);
const requestedMaxRecords = Number.parseInt(
  String(process.env.AGE_EXPIRATION_TASK_MAX_RECORDS || '100000'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(500, requestedPageSize))
  : 100;
const maxRecords = Number.isFinite(requestedMaxRecords)
  ? Math.max(1, Math.min(500_000, requestedMaxRecords))
  : 100_000;

function initializeAdmin() {
  if (getApps().length) return;

  const serviceAccountJson =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function positiveTime(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMillis(value) {
  const direct = positiveTime(value);
  if (direct !== null) return direct;

  if (value && typeof value.toMillis === 'function') {
    return positiveTime(value.toMillis());
  }

  return null;
}

function cleanUid(value) {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function buildTaskId({ uid, expiresAtMs, expectedUpdatedAtMs }) {
  const digest = createHash('sha256')
    .update([uid, expectedUpdatedAtMs, expiresAtMs].join(':'))
    .digest('hex')
    .slice(0, 32);

  return `age-expiry-${digest}`;
}

function isAlreadyExistsError(error) {
  const code = String(error?.code ?? '').trim().toLowerCase();
  return code.includes('already-exists') ||
    code.includes('task-already-exists');
}

async function main() {
  if (!dryRun && !apply) {
    throw new Error(
      'Execução real bloqueada. Defina AGE_EXPIRATION_TASK_APPLY=true.'
    );
  }

  initializeAdmin();

  const db = getFirestore();
  const queue = getFunctions().taskQueue(
    `locations/${FUNCTIONS_REGION}/functions/expireAgeEligibilityAtBoundary`
  );
  const nowMs = Date.now();

  let cursor = null;
  let scanned = 0;
  let pages = 0;
  let finiteCandidates = 0;
  let invalid = 0;
  let wouldEnqueue = 0;
  let enqueued = 0;
  let alreadyExists = 0;

  while (scanned < maxRecords) {
    const remaining = maxRecords - scanned;
    const currentLimit = Math.min(pageSize, remaining);

    let query = db
      .collection('age_eligibility_records')
      .where('status', '==', 'VERIFIED_ADULT')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    pages += 1;
    cursor = snapshot.docs.at(-1);

    for (const document of snapshot.docs) {
      scanned += 1;

      const raw = document.data() ?? {};
      const uid = cleanUid(document.id);
      const recordUid = cleanUid(raw.uid);
      const policyVersion = Number(raw.policyVersion);
      const verifiedAtMs =
        toMillis(raw.verifiedAtMs) ?? toMillis(raw.verifiedAt);
      const expiresAtMs =
        toMillis(raw.expiresAtMs) ?? toMillis(raw.expiresAt);
      const expectedUpdatedAtMs =
        toMillis(raw.updatedAtMs) ?? toMillis(raw.updatedAt);

      if (expiresAtMs === null) {
        continue;
      }

      finiteCandidates += 1;

      if (
        !uid ||
        recordUid !== uid ||
        policyVersion !== 1 ||
        verifiedAtMs === null ||
        expectedUpdatedAtMs === null
      ) {
        invalid += 1;
        console.warn('[age-expiration-task-backfill] registro inválido', {
          uid: document.id,
          policyVersion,
          verifiedAtMs,
          expiresAtMs,
          expectedUpdatedAtMs,
        });
        continue;
      }

      const payload = {
        uid,
        expiresAtMs,
        expectedUpdatedAtMs,
      };

      wouldEnqueue += 1;

      if (dryRun) {
        continue;
      }

      try {
        await queue.enqueue(payload, {
          id: buildTaskId(payload),
          scheduleTime: new Date(Math.max(expiresAtMs, Date.now() + 1_000)),
          dispatchDeadlineSeconds: 60,
        });
        enqueued += 1;
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          alreadyExists += 1;
          continue;
        }

        throw error;
      }
    }

    if (snapshot.size < currentLimit) break;
  }

  const summary = {
    projectId,
    region: FUNCTIONS_REGION,
    dryRun,
    applied: !dryRun && apply,
    pageSize,
    maxRecords,
    pages,
    scanned,
    finiteCandidates,
    invalid,
    wouldEnqueue,
    enqueued,
    alreadyExists,
    startedAtMs: nowMs,
    completedAtMs: Date.now(),
    lastCursor: cursor?.id ?? null,
  };

  console.log('[age-expiration-task-backfill] resumo', summary);
}

main().catch((error) => {
  console.error('[age-expiration-task-backfill] falhou', {
    code: error?.code,
    message: error?.message,
  });
  process.exitCode = 1;
});
