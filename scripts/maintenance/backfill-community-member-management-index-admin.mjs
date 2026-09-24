// scripts/maintenance/backfill-community-member-management-index-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DO ÍNDICE ADMINISTRATIVO DE MEMBROS
// -----------------------------------------------------------------------------
// Dry-run por padrão. O índice é derivado e descartável: não altera membership,
// papel, ownership ou elegibilidade. Execução real exige confirmação explícita.
//
// PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:COMMUNITY_MEMBER_MANAGEMENT_INDEX_DRY_RUN='true'
// npm run maintenance:community-member-management-index
//
// Escrita real, somente após os triggers de sincronização estarem publicados:
// $env:COMMUNITY_MEMBER_MANAGEMENT_INDEX_DRY_RUN='false'
// $env:COMMUNITY_MEMBER_MANAGEMENT_INDEX_CONFIRM='true'
// npm run maintenance:community-member-management-index
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  String(process.env.COMMUNITY_MEMBER_MANAGEMENT_INDEX_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';
const confirmed =
  String(process.env.COMMUNITY_MEMBER_MANAGEMENT_INDEX_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';
const pageSize = Math.max(
  1,
  Math.min(
    300,
    Number.parseInt(
      String(process.env.COMMUNITY_MEMBER_MANAGEMENT_INDEX_PAGE_SIZE || '200'),
      10
    ) || 200
  )
);
const maxCommunities = Math.max(
  1,
  Math.min(
    100_000,
    Number.parseInt(
      String(process.env.COMMUNITY_MEMBER_MANAGEMENT_INDEX_MAX_COMMUNITIES || '10000'),
      10
    ) || 10_000
  )
);
function countSearchPrefixCompositeIndexes() {
  const indexPath = resolve(process.cwd(), 'firestore.indexes.json');
  const config = JSON.parse(readFileSync(indexPath, 'utf8'));
  const indexes = Array.isArray(config?.indexes) ? config.indexes : [];

  return indexes.filter((index) =>
    index?.collectionGroup === 'community_member_management_index'
    && Array.isArray(index?.fields)
    && index.fields.some(
      (field) =>
        field?.fieldPath === 'searchPrefixes'
        && field?.arrayConfig === 'CONTAINS'
    )
  ).length;
}

const searchPrefixCompositeIndexCount =
  countSearchPrefixCompositeIndexes();

const maxMemberships = Math.max(
  1,
  Math.min(
    5_000_000,
    Number.parseInt(
      String(process.env.COMMUNITY_MEMBER_MANAGEMENT_INDEX_MAX_MEMBERSHIPS || '1000000'),
      10
    ) || 1_000_000
  )
);

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

async function loadPolicy() {
  try {
    const module = await import(
      '../../functions/lib/community/community-member-management-index.policy.js'
    );

    if (
      typeof module.buildCommunityMemberManagementIndexProjection !== 'function'
      || typeof module.communityMemberManagementProjectionId !== 'function'
    ) {
      throw new Error('Policy canônica do índice administrativo não encontrada.');
    }

    return module;
  } catch (error) {
    throw new Error(
      [
        'Não foi possível carregar a policy compilada.',
        'Execute "npm run functions:build" antes deste script.',
        error instanceof Error ? error.message : String(error),
      ].join(' ')
    );
  }
}

function isManageableCommunity(data) {
  return data?.source?.type === 'community'
    && (data?.status === 'active' || data?.status === 'paused');
}

async function readUsers(db, memberDocs) {
  const refs = memberDocs.map((document) =>
    db.collection('users').doc(document.id)
  );

  if (!refs.length) return [];
  return db.getAll(...refs);
}

async function writeProjectionPage(db, writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();

    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(
        write.ref,
        {
          ...write.projection,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
  }
}

async function processCommunity(db, policy, communityDocument, counters) {
  let cursor = null;

  while (counters.scannedMemberships < maxMemberships) {
    const remaining = maxMemberships - counters.scannedMemberships;
    const currentLimit = Math.min(pageSize, remaining);
    let query = communityDocument.ref
      .collection('members')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) return true;

    cursor = snapshot.docs.at(-1);
    counters.scannedMemberships += snapshot.size;

    const candidates = snapshot.docs.filter((document) => {
      const status = document.data()?.status;
      return status === 'active' || status === 'blocked';
    });
    const userSnapshots = await readUsers(db, candidates);
    const writes = [];

    candidates.forEach((document, index) => {
      const projection = policy.buildCommunityMemberManagementIndexProjection({
        communityId: communityDocument.id,
        memberId: document.id,
        rawMembership: document.data(),
        rawUser: userSnapshots[index]?.exists
          ? userSnapshots[index].data()
          : null,
      });

      if (!projection) {
        counters.skipped += 1;
        return;
      }

      counters.projected += 1;
      const searchPrefixCount = Array.isArray(projection.searchPrefixes)
        ? projection.searchPrefixes.length
        : 0;
      counters.searchPrefixValues += searchPrefixCount;
      counters.maxSearchPrefixesPerProjection = Math.max(
        counters.maxSearchPrefixesPerProjection,
        searchPrefixCount
      );
      counters.estimatedSearchPrefixCompositeEntries +=
        searchPrefixCount * searchPrefixCompositeIndexCount;

      writes.push({
        ref: db
          .collection('community_member_management_index')
          .doc(
            policy.communityMemberManagementProjectionId(
              communityDocument.id,
              document.id
            )
          ),
        projection,
      });
    });

    if (!dryRun && writes.length) {
      await writeProjectionPage(db, writes);
      counters.written += writes.length;
    }

    console.log('[community-member-management-index] progresso', {
      communityId: communityDocument.id,
      scannedCommunities: counters.scannedCommunities,
      scannedMemberships: counters.scannedMemberships,
      projected: counters.projected,
      written: counters.written,
      skipped: counters.skipped,
      dryRun,
    });

    if (snapshot.size < currentLimit) return true;
  }

  return false;
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Execução real bloqueada. Defina COMMUNITY_MEMBER_MANAGEMENT_INDEX_CONFIRM=true.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const policy = await loadPolicy();
  const counters = {
    scannedCommunities: 0,
    manageableCommunities: 0,
    scannedMemberships: 0,
    projected: 0,
    searchPrefixValues: 0,
    maxSearchPrefixesPerProjection: 0,
    estimatedSearchPrefixCompositeEntries: 0,
    written: 0,
    skipped: 0,
    failures: 0,
  };

  let communityCursor = null;
  let complete = false;

  while (
    counters.scannedCommunities < maxCommunities
    && counters.scannedMemberships < maxMemberships
  ) {
    const remaining = maxCommunities - counters.scannedCommunities;
    const currentLimit = Math.min(pageSize, remaining);
    let query = db
      .collection('communities')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (communityCursor) query = query.startAfter(communityCursor);

    const snapshot = await query.get();
    if (snapshot.empty) {
      complete = true;
      break;
    }

    communityCursor = snapshot.docs.at(-1);

    for (const communityDocument of snapshot.docs) {
      counters.scannedCommunities += 1;
      if (!isManageableCommunity(communityDocument.data())) continue;

      counters.manageableCommunities += 1;

      try {
        const membershipComplete = await processCommunity(
          db,
          policy,
          communityDocument,
          counters
        );

        if (!membershipComplete) break;
      } catch (error) {
        counters.failures += 1;
        console.error('[community-member-management-index] falha', {
          communityId: communityDocument.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (counters.scannedMemberships >= maxMemberships) break;
    }

    if (snapshot.size < currentLimit) {
      complete = true;
      break;
    }
  }

  console.log('[community-member-management-index] resumo', {
    projectId,
    dryRun,
    pageSize,
    maxCommunities,
    maxMemberships,
    searchPrefixCompositeIndexCount,
    averageSearchPrefixesPerProjection:
      counters.projected > 0
        ? Number(
            (counters.searchPrefixValues / counters.projected).toFixed(2)
          )
        : 0,
    ...counters,
    complete,
    truncated:
      !complete
      && (
        counters.scannedCommunities >= maxCommunities
        || counters.scannedMemberships >= maxMemberships
      ),
  });

  if (!dryRun && counters.failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[community-member-management-index] erro fatal', error);
  process.exitCode = 1;
});
