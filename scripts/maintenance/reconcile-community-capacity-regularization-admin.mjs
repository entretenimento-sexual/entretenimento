// scripts/maintenance/reconcile-community-capacity-regularization-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DE REGULARIZAÇÃO DE CAPACIDADE/OWNERSHIP DE COMUNIDADES
// -----------------------------------------------------------------------------
// Objetivo:
// - cobrir owners já existentes no momento do rollout, pois triggers Firestore
//   não são retroativos;
// - reutilizar o service canônico de Functions, sem duplicar regra comercial;
// - não criar scheduler permanente nem novas fontes de verdade.
//
// Segurança:
// - dry-run por padrão;
// - execução real exige COMMUNITY_CAPACITY_REGULARIZATION_CONFIRM=true;
// - pagina somente communities e deduplica ownerUid;
// - não transfere ownership, não arquiva e não remove memberships;
// - a execução real apenas chama a reconciliação canônica por owner.
//
// PowerShell:
// npm run functions:build
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:COMMUNITY_CAPACITY_REGULARIZATION_DRY_RUN='true'
// node scripts/maintenance/reconcile-community-capacity-regularization-admin.mjs
//
// Execução real, somente depois do deploy de syncCommunityCapacityRegularization:
// $env:COMMUNITY_CAPACITY_REGULARIZATION_DRY_RUN='false'
// $env:COMMUNITY_CAPACITY_REGULARIZATION_CONFIRM='true'
// node scripts/maintenance/reconcile-community-capacity-regularization-admin.mjs
// -----------------------------------------------------------------------------

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

const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();

const dryRun =
  String(process.env.COMMUNITY_CAPACITY_REGULARIZATION_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';

const confirmed =
  String(process.env.COMMUNITY_CAPACITY_REGULARIZATION_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.COMMUNITY_CAPACITY_REGULARIZATION_PAGE_SIZE || '200'),
  10
);

const requestedMaxDocuments = Number.parseInt(
  String(process.env.COMMUNITY_CAPACITY_REGULARIZATION_MAX || '10000'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(400, requestedPageSize))
  : 200;

const maxDocuments = Number.isFinite(requestedMaxDocuments)
  ? Math.max(1, Math.min(100_000, requestedMaxDocuments))
  : 10_000;

const ACTIVE_OWNERSHIP_STATUSES = new Set([
  'active',
  'paused',
  'dormant',
]);

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

function normalizeOwnerUid(value) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized)
    ? normalized
    : null;
}

function isOwnedPersonalCommunity(data) {
  const source = data?.source;
  return source?.type === 'community'
    && ACTIVE_OWNERSHIP_STATUSES.has(String(data?.status ?? '').trim())
    && normalizeOwnerUid(data?.ownerUid) !== null;
}

async function loadCanonicalReconciler() {
  try {
    const module = await import(
      '../../functions/lib/community/community-capacity-regularization.service.js'
    );

    if (
      typeof module.reconcilePersonalCommunityCapacityRegularization !==
      'function'
    ) {
      throw new Error('Export canônico de reconciliação não encontrado.');
    }

    return module.reconcilePersonalCommunityCapacityRegularization;
  } catch (error) {
    throw new Error(
      [
        'Não foi possível carregar a reconciliação compilada.',
        'Execute "npm run functions:build" antes deste script.',
        error instanceof Error ? error.message : String(error),
      ].join(' ')
    );
  }
}

async function collectOwners(db) {
  const ownerUids = new Set();
  let cursor = null;
  let scanned = 0;
  let matchingCommunities = 0;
  let pages = 0;
  let scanComplete = false;

  while (scanned < maxDocuments) {
    const remaining = maxDocuments - scanned;
    const currentLimit = Math.min(pageSize, remaining);

    let query = db
      .collection('communities')
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

    for (const document of snapshot.docs) {
      const data = document.data();
      if (!isOwnedPersonalCommunity(data)) continue;

      matchingCommunities += 1;
      const ownerUid = normalizeOwnerUid(data?.ownerUid);
      if (ownerUid) ownerUids.add(ownerUid);
    }

    console.log('[community-capacity-regularization] scan', {
      pages,
      scanned,
      matchingCommunities,
      uniqueOwners: ownerUids.size,
      dryRun,
    });

    if (snapshot.size < currentLimit) {
      scanComplete = true;
      break;
    }
  }

  return {
    ownerUids: [...ownerUids].sort(),
    pages,
    scanned,
    matchingCommunities,
    scanComplete,
    truncatedByMaxDocuments: !scanComplete && scanned >= maxDocuments,
  };
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      [
        'Execução real bloqueada.',
        'Defina COMMUNITY_CAPACITY_REGULARIZATION_CONFIRM=true.',
      ].join(' ')
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const scan = await collectOwners(db);

  if (dryRun) {
    console.log('[community-capacity-regularization] resumo', {
      projectId,
      dryRun,
      pageSize,
      maxDocuments,
      pages: scan.pages,
      scanned: scan.scanned,
      matchingCommunities: scan.matchingCommunities,
      uniqueOwners: scan.ownerUids.length,
      scanComplete: scan.scanComplete,
      truncatedByMaxDocuments: scan.truncatedByMaxDocuments,
      ownersToReconcile: scan.ownerUids,
    });
    return;
  }

  if (!scan.scanComplete) {
    throw new Error(
      'Scan incompleto. Aumente COMMUNITY_CAPACITY_REGULARIZATION_MAX.'
    );
  }

  const reconcile = await loadCanonicalReconciler();
  let reconciledOwners = 0;
  let inspectedCommunities = 0;
  let regularizedCommunities = 0;
  let clearedCommunities = 0;
  let ownershipOverPlanOwners = 0;
  const failures = [];

  for (const ownerUid of scan.ownerUids) {
    try {
      const result = await reconcile({ ownerUid });

      reconciledOwners += 1;
      inspectedCommunities += result.inspectedCommunities;
      regularizedCommunities += result.regularizedCommunities;
      clearedCommunities += result.clearedCommunities;
      if (result.ownershipOverPlan) ownershipOverPlanOwners += 1;

      console.log('[community-capacity-regularization] owner', {
        ownerUid,
        inspectedCommunities: result.inspectedCommunities,
        regularizedCommunities: result.regularizedCommunities,
        clearedCommunities: result.clearedCommunities,
        ownershipOverPlan: result.ownershipOverPlan,
      });
    } catch (error) {
      failures.push({
        ownerUid,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
    }
  }

  const summary = {
    projectId,
    dryRun,
    confirmed,
    pageSize,
    maxDocuments,
    pages: scan.pages,
    scanned: scan.scanned,
    matchingCommunities: scan.matchingCommunities,
    uniqueOwners: scan.ownerUids.length,
    reconciledOwners,
    inspectedCommunities,
    regularizedCommunities,
    clearedCommunities,
    ownershipOverPlanOwners,
    failures,
    scanComplete: scan.scanComplete,
  };

  console.log('[community-capacity-regularization] resumo', summary);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[community-capacity-regularization] falhou', {
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  });
  process.exitCode = 1;
});
