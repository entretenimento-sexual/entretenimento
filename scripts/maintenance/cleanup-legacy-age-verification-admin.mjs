// scripts/maintenance/cleanup-legacy-age-verification-admin.mjs
// -----------------------------------------------------------------------------
// CLEANUP CONTROLADO DO CAMPO LEGADO users/{uid}.ageVerification
// -----------------------------------------------------------------------------
// Segurança:
// - dry-run por padrão;
// - execução real exige LEGACY_AGE_CLEANUP_CONFIRM=true;
// - nunca cria ageEligibility;
// - nunca usa idade, adultConsent ou ageVerification para inferir maioridade;
// - remove exclusivamente o campo legado ageVerification;
// - pagina por documentId para limitar custo/memória;
// - registra um único resumo operacional ao final da execução real.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';

const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();

const dryRun =
  String(process.env.LEGACY_AGE_CLEANUP_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';

const confirmed =
  String(process.env.LEGACY_AGE_CLEANUP_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.LEGACY_AGE_CLEANUP_PAGE_SIZE || '100'),
  10
);

const maxDocuments = Number.parseInt(
  String(process.env.LEGACY_AGE_CLEANUP_MAX || '5000'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(300, requestedPageSize))
  : 100;

const safeMaxDocuments = Number.isFinite(maxDocuments)
  ? Math.max(1, Math.min(100_000, maxDocuments))
  : 5000;

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

function hasLegacyAgeVerification(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    Object.prototype.hasOwnProperty.call(data, 'ageVerification')
  );
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Execução real bloqueada. Defina LEGACY_AGE_CLEANUP_CONFIRM=true.'
    );
  }

  initializeAdmin();

  const db = getFirestore();
  const runId = randomUUID();
  let cursor = null;
  let scanned = 0;
  let matched = 0;
  let removed = 0;
  let pages = 0;
  let scanComplete = false;

  while (scanned < safeMaxDocuments) {
    const remaining = safeMaxDocuments - scanned;
    const currentLimit = Math.min(pageSize, remaining);

    let query = db
      .collection('users')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      scanComplete = true;
      break;
    }

    pages += 1;
    scanned += snapshot.size;
    cursor = snapshot.docs.at(-1);

    const matches = snapshot.docs.filter((doc) =>
      hasLegacyAgeVerification(doc.data())
    );

    matched += matches.length;

    for (const doc of matches) {
      console.log('[legacy-age-cleanup] match', {
        uid: doc.id,
        dryRun,
      });
    }

    if (!dryRun && matches.length > 0) {
      const batch = db.batch();

      for (const doc of matches) {
        batch.update(doc.ref, {
          ageVerification: FieldValue.delete(),
        });
      }

      await batch.commit();
      removed += matches.length;
    }

    if (snapshot.size < currentLimit) {
      scanComplete = true;
      break;
    }
  }

  const summary = {
    runId,
    projectId,
    dryRun,
    confirmed: !dryRun && confirmed,
    pageSize,
    maxDocuments: safeMaxDocuments,
    pages,
    scanned,
    matched,
    removed,
    scanComplete,
    truncatedByMaxDocuments: !scanComplete && scanned >= safeMaxDocuments,
  };

  console.log('[legacy-age-cleanup] resumo', summary);

  if (!dryRun) {
    await db.collection('compliance_audit').doc(
      `legacy_age_cleanup_${runId}`
    ).set({
      type: 'age_verification.legacy_cleanup',
      source: 'maintenance-script',
      scanned,
      matched,
      removed,
      pageSize,
      maxDocuments: safeMaxDocuments,
      scanComplete,
      truncatedByMaxDocuments:
        !scanComplete && scanned >= safeMaxDocuments,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
  }
}

main().catch((error) => {
  console.error('[legacy-age-cleanup] falhou', {
    code: error?.code,
    message: error?.message,
  });
  process.exitCode = 1;
});
