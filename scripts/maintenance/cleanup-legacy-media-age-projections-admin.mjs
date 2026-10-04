// scripts/maintenance/cleanup-legacy-media-age-projections-admin.mjs
// -----------------------------------------------------------------------------
// CLEANUP CONTROLADO DE PROJEÇÕES ETÁRIAS LEGADAS EM MEDIA
// -----------------------------------------------------------------------------
// Contrato:
// - dry-run por padrão;
// - execução real exige LEGACY_MEDIA_AGE_CLEANUP_CONFIRM=true;
// - nunca lê ou altera age_eligibility_records;
// - nunca decide maioridade;
// - remove somente campos etários legados de projeções públicas/publicações;
// - quando encontra o antigo ageReverificationHidden, restaura somente o estado
//   anterior explicitamente gravado no próprio documento antes de apagar markers;
// - restrição etária continua pertencendo ao lifecycle da conta.
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
  String(process.env.LEGACY_MEDIA_AGE_CLEANUP_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';

const confirmed =
  String(process.env.LEGACY_MEDIA_AGE_CLEANUP_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.LEGACY_MEDIA_AGE_CLEANUP_PAGE_SIZE || '100'),
  10
);

const requestedMaxDocuments = Number.parseInt(
  String(process.env.LEGACY_MEDIA_AGE_CLEANUP_MAX || '20000'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(300, requestedPageSize))
  : 100;

const maxDocuments = Number.isFinite(requestedMaxDocuments)
  ? Math.max(1, Math.min(200_000, requestedMaxDocuments))
  : 20_000;

const LEGACY_PROJECTION_FIELDS = [
  'ageEligibilityAdultAccessAllowed',
  'ageEligibilityVerifiedAdult',
  'ageEligibilityAssurance',
  'ageEligibilityValidUntil',
];

const LEGACY_REVERIFICATION_FIELDS = [
  'ageReverificationHidden',
  'ageReverificationCaseId',
  'ageReverificationPreviousVisibility',
  'ageReverificationPreviousModerationStatus',
  'ageReverificationPreviousModerationReason',
  'ageReverificationHiddenAt',
  'ageReverificationRestoredAt',
];

const SCOPES = [
  { kind: 'collection', name: 'public_profiles' },
  { kind: 'collectionGroup', name: 'public_photos' },
  { kind: 'collectionGroup', name: 'public_videos' },
  { kind: 'collectionGroup', name: 'photo_publications' },
  { kind: 'collectionGroup', name: 'video_publications' },
];

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

function hasOwn(data, field) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    Object.prototype.hasOwnProperty.call(data, field)
  );
}

function normalizeVisibility(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['PUBLIC', 'PRIVATE', 'FRIENDS', 'SUBSCRIBERS', 'PREMIUM'].includes(
    normalized
  )
    ? normalized
    : null;
}

function normalizeModerationStatus(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['APPROVED', 'PENDING_REVIEW', 'FLAGGED', 'HIDDEN', 'REJECTED'].includes(
    normalized
  )
    ? normalized
    : null;
}

function buildCleanupPatch(data) {
  const patch = {};
  let legacyProjectionFields = 0;
  let legacyReverificationFields = 0;
  let restoresVisibility = false;
  let restoresModeration = false;

  for (const field of LEGACY_PROJECTION_FIELDS) {
    if (!hasOwn(data, field)) continue;
    patch[field] = FieldValue.delete();
    legacyProjectionFields += 1;
  }

  if (data?.ageReverificationHidden === true) {
    const previousVisibility = normalizeVisibility(
      data.ageReverificationPreviousVisibility
    );
    if (previousVisibility) {
      patch.visibility = previousVisibility;
      restoresVisibility = true;
    }

    const previousModerationStatus = normalizeModerationStatus(
      data.ageReverificationPreviousModerationStatus
    );
    if (previousModerationStatus) {
      patch.moderationStatus = previousModerationStatus;
      restoresModeration = true;
    }

    if (hasOwn(data, 'ageReverificationPreviousModerationReason')) {
      const previousReason = data.ageReverificationPreviousModerationReason;
      patch.moderationReason =
        previousReason == null
          ? FieldValue.delete()
          : String(previousReason);
    }
  }

  for (const field of LEGACY_REVERIFICATION_FIELDS) {
    if (!hasOwn(data, field)) continue;
    patch[field] = FieldValue.delete();
    legacyReverificationFields += 1;
  }

  return {
    patch,
    matched:
      legacyProjectionFields > 0 ||
      legacyReverificationFields > 0,
    legacyProjectionFields,
    legacyReverificationFields,
    restoresVisibility,
    restoresModeration,
  };
}

function baseQuery(db, scope) {
  return scope.kind === 'collection'
    ? db.collection(scope.name)
    : db.collectionGroup(scope.name);
}

async function scanScope(db, scope, remainingBudget, summary) {
  let cursor = null;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let pages = 0;
  let restoredVisibility = 0;
  let restoredModeration = 0;
  let scanComplete = false;

  while (scanned < remainingBudget) {
    const remaining = remainingBudget - scanned;
    const currentLimit = Math.min(pageSize, remaining);

    let query = baseQuery(db, scope)
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

    const matches = snapshot.docs
      .map((document) => ({
        document,
        cleanup: buildCleanupPatch(document.data()),
      }))
      .filter((entry) => entry.cleanup.matched);

    matched += matches.length;

    for (const entry of matches) {
      if (entry.cleanup.restoresVisibility) restoredVisibility += 1;
      if (entry.cleanup.restoresModeration) restoredModeration += 1;

      console.log('[legacy-media-age-cleanup] match', {
        scope: scope.name,
        path: entry.document.ref.path,
        legacyProjectionFields: entry.cleanup.legacyProjectionFields,
        legacyReverificationFields:
          entry.cleanup.legacyReverificationFields,
        restoresVisibility: entry.cleanup.restoresVisibility,
        restoresModeration: entry.cleanup.restoresModeration,
        dryRun,
      });
    }

    if (!dryRun && matches.length > 0) {
      const batch = db.batch();

      for (const entry of matches) {
        batch.update(entry.document.ref, entry.cleanup.patch);
      }

      await batch.commit();
      updated += matches.length;
    }

    if (snapshot.size < currentLimit) {
      scanComplete = true;
      break;
    }
  }

  summary.scanned += scanned;
  summary.matched += matched;
  summary.updated += updated;
  summary.pages += pages;
  summary.restoredVisibility += restoredVisibility;
  summary.restoredModeration += restoredModeration;
  summary.scopes.push({
    kind: scope.kind,
    name: scope.name,
    scanned,
    matched,
    updated,
    pages,
    restoredVisibility,
    restoredModeration,
    scanComplete,
  });
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Execução real bloqueada. Defina LEGACY_MEDIA_AGE_CLEANUP_CONFIRM=true.'
    );
  }

  initializeAdmin();

  const db = getFirestore();
  const runId = randomUUID();
  const summary = {
    runId,
    projectId,
    dryRun,
    confirmed: !dryRun && confirmed,
    pageSize,
    maxDocuments,
    scanned: 0,
    matched: 0,
    updated: 0,
    pages: 0,
    restoredVisibility: 0,
    restoredModeration: 0,
    scopes: [],
  };

  for (const scope of SCOPES) {
    const remainingBudget = maxDocuments - summary.scanned;
    if (remainingBudget <= 0) break;

    await scanScope(db, scope, remainingBudget, summary);
  }

  summary.truncatedByMaxDocuments =
    summary.scanned >= maxDocuments &&
    summary.scopes.some((scope) => scope.scanComplete !== true);

  console.log('[legacy-media-age-cleanup] resumo', summary);

  if (!dryRun) {
    await db.collection('compliance_audit').doc(
      `legacy_media_age_cleanup_${runId}`
    ).set({
      type: 'media.age_projection.legacy_cleanup',
      source: 'maintenance-script',
      scanned: summary.scanned,
      matched: summary.matched,
      updated: summary.updated,
      restoredVisibility: summary.restoredVisibility,
      restoredModeration: summary.restoredModeration,
      pageSize,
      maxDocuments,
      truncatedByMaxDocuments: summary.truncatedByMaxDocuments,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
  }
}

main().catch((error) => {
  console.error('[legacy-media-age-cleanup] falhou', {
    code: error?.code,
    message: error?.message,
  });
  process.exitCode = 1;
});
