// scripts/maintenance/backfill-community-topic-search-prefixes-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DOS PREFIXOS DE BUSCA DE DISCUSSÕES
// -----------------------------------------------------------------------------
// Dry-run por padrão. Atualiza somente a projeção derivada
// community_public_topics/{communityId}/items/{topicId}; não altera o Tópico
// operacional, audiência, moderação, métricas ou ownership.
//
// PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:COMMUNITY_TOPIC_SEARCH_BACKFILL_DRY_RUN='true'
// npm run maintenance:community-topic-search
//
// Escrita real, apenas dentro da janela futura aprovada:
// $env:COMMUNITY_TOPIC_SEARCH_BACKFILL_DRY_RUN='false'
// $env:COMMUNITY_TOPIC_SEARCH_BACKFILL_CONFIRM='true'
// npm run maintenance:community-topic-search
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
  String(process.env.COMMUNITY_TOPIC_SEARCH_BACKFILL_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';
const confirmed =
  String(process.env.COMMUNITY_TOPIC_SEARCH_BACKFILL_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';
const pageSize = Math.max(
  1,
  Math.min(
    300,
    Number.parseInt(
      String(process.env.COMMUNITY_TOPIC_SEARCH_BACKFILL_PAGE_SIZE || '200'),
      10
    ) || 200
  )
);
const maxCommunities = Math.max(
  1,
  Math.min(
    100_000,
    Number.parseInt(
      String(process.env.COMMUNITY_TOPIC_SEARCH_BACKFILL_MAX_COMMUNITIES || '10000'),
      10
    ) || 10_000
  )
);
const maxTopics = Math.max(
  1,
  Math.min(
    5_000_000,
    Number.parseInt(
      String(process.env.COMMUNITY_TOPIC_SEARCH_BACKFILL_MAX_TOPICS || '1000000'),
      10
    ) || 1_000_000
  )
);

function initializeAdmin() {
  if (getApps().length) return;

  const serviceAccountJson =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  initializeApp({
    credential: serviceAccountJson
      ? cert(JSON.parse(serviceAccountJson))
      : applicationDefault(),
    projectId,
  });
}

async function loadPolicy() {
  try {
    const module = await import(
      '../../functions/lib/community/community-search-text.policy.js'
    );

    if (typeof module.buildCommunitySearchPrefixes !== 'function') {
      throw new Error('Policy canônica da busca interna não encontrada.');
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

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

async function writePage(db, writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();

    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(
        write.ref,
        { searchPrefixes: write.searchPrefixes },
        { merge: true }
      );
    }

    await batch.commit();
  }
}

async function processCommunity(db, policy, communityId, counters) {
  let cursor = null;

  while (counters.scannedTopics < maxTopics) {
    const remaining = maxTopics - counters.scannedTopics;
    const currentLimit = Math.min(pageSize, remaining);
    let query = db
      .collection('community_public_topics')
      .doc(communityId)
      .collection('items')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) return true;

    cursor = snapshot.docs.at(-1);
    counters.scannedTopics += snapshot.size;
    const writes = [];

    for (const document of snapshot.docs) {
      const data = document.data() ?? {};
      const searchPrefixes = policy.buildCommunitySearchPrefixes(
        data.title,
        data.excerpt
      );
      const currentPrefixes = Array.isArray(data.searchPrefixes)
        ? data.searchPrefixes
        : [];

      counters.prefixValues += searchPrefixes.length;
      counters.maxPrefixesPerTopic = Math.max(
        counters.maxPrefixesPerTopic,
        searchPrefixes.length
      );

      if (arraysEqual(currentPrefixes, searchPrefixes)) {
        counters.alreadyCurrent += 1;
        continue;
      }

      counters.projected += 1;
      writes.push({ ref: document.ref, searchPrefixes });
    }

    if (!dryRun && writes.length) {
      await writePage(db, writes);
      counters.written += writes.length;
    }

    console.log('[community-topic-search] progresso', {
      communityId,
      scannedCommunities: counters.scannedCommunities,
      scannedTopics: counters.scannedTopics,
      projected: counters.projected,
      written: counters.written,
      alreadyCurrent: counters.alreadyCurrent,
      dryRun,
    });

    if (snapshot.size < currentLimit) return true;
  }

  return false;
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Escrita bloqueada: defina COMMUNITY_TOPIC_SEARCH_BACKFILL_CONFIRM=true.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const policy = await loadPolicy();
  const counters = {
    scannedCommunities: 0,
    scannedTopics: 0,
    projected: 0,
    written: 0,
    alreadyCurrent: 0,
    skippedCommunities: 0,
    prefixValues: 0,
    maxPrefixesPerTopic: 0,
    failures: 0,
    scanComplete: true,
  };

  let cursor = null;

  while (counters.scannedCommunities < maxCommunities) {
    const remaining = maxCommunities - counters.scannedCommunities;
    let query = db
      .collection('communities')
      .orderBy(FieldPath.documentId())
      .limit(Math.min(pageSize, remaining));

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;
    cursor = snapshot.docs.at(-1);

    for (const communityDocument of snapshot.docs) {
      counters.scannedCommunities += 1;
      if (communityDocument.data()?.source?.type !== 'community') {
        counters.skippedCommunities += 1;
        continue;
      }

      try {
        const completed = await processCommunity(
          db,
          policy,
          communityDocument.id,
          counters
        );
        if (!completed) {
          counters.scanComplete = false;
          break;
        }
      } catch (error) {
        counters.failures += 1;
        counters.scanComplete = false;
        console.error('[community-topic-search] falha', {
          communityId: communityDocument.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (counters.scannedTopics >= maxTopics) {
        counters.scanComplete = false;
        break;
      }
    }

    if (
      !counters.scanComplete
      || snapshot.size < Math.min(pageSize, remaining)
    ) {
      break;
    }
  }

  if (counters.scannedCommunities >= maxCommunities) {
    const probe = cursor
      ? await db
          .collection('communities')
          .orderBy(FieldPath.documentId())
          .startAfter(cursor)
          .limit(1)
          .get()
      : null;
    if (probe && !probe.empty) counters.scanComplete = false;
  }

  const averagePrefixesPerTopic = counters.scannedTopics > 0
    ? counters.prefixValues / counters.scannedTopics
    : 0;

  console.log('[community-topic-search] resumo', {
    ...counters,
    averagePrefixesPerTopic,
    dryRun,
    confirmed,
    projectId,
  });

  if (!counters.scanComplete || counters.failures > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[community-topic-search] abortado', error);
  process.exitCode = 1;
});
