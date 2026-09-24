// scripts/maintenance/backfill-community-explore-content-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DO ÍNDICE EFÊMERO DE CONTEÚDO DE COMUNIDADES NO EXPLORE
// -----------------------------------------------------------------------------
// Dry-run por padrão. Reaproveita o builder compilado das Functions para não
// duplicar a regra de elegibilidade do runtime.
//
// PowerShell:
// npm run functions:build
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:COMMUNITY_EXPLORE_CONTENT_BACKFILL_DRY_RUN='true'
// npm run maintenance:community-explore-content
//
// Execução real, depois do deploy do novo runtime:
// $env:COMMUNITY_EXPLORE_CONTENT_BACKFILL_DRY_RUN='false'
// $env:COMMUNITY_EXPLORE_CONTENT_BACKFILL_CONFIRM='true'
// npm run maintenance:community-explore-content
// -----------------------------------------------------------------------------

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  FieldPath,
  Timestamp,
  getFirestore,
} from 'firebase-admin/firestore';

const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();
const dryRun =
  String(process.env.COMMUNITY_EXPLORE_CONTENT_BACKFILL_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';
const confirmed =
  String(process.env.COMMUNITY_EXPLORE_CONTENT_BACKFILL_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.COMMUNITY_EXPLORE_CONTENT_BACKFILL_PAGE_SIZE || '100'),
  10
);
const requestedMaxCommunities = Number.parseInt(
  String(process.env.COMMUNITY_EXPLORE_CONTENT_BACKFILL_MAX_COMMUNITIES || '5000'),
  10
);
const requestedPostsPerCommunity = Number.parseInt(
  String(process.env.COMMUNITY_EXPLORE_CONTENT_BACKFILL_POSTS_PER_COMMUNITY || '12'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(300, requestedPageSize))
  : 100;
const maxCommunities = Number.isFinite(requestedMaxCommunities)
  ? Math.max(1, Math.min(100_000, requestedMaxCommunities))
  : 5_000;
const postsPerCommunity = Number.isFinite(requestedPostsPerCommunity)
  ? Math.max(1, Math.min(24, requestedPostsPerCommunity))
  : 12;

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

async function loadProjectionBuilder() {
  try {
    const module = await import(
      '../../functions/lib/community/community-explore-content.model.js'
    );

    if (
      typeof module.buildCommunityExploreContentProjection !== 'function'
      || !Number.isFinite(module.COMMUNITY_EXPLORE_CONTENT_RETENTION_MS)
    ) {
      throw new Error('Contrato compilado do Explore não encontrado.');
    }

    return {
      build: module.buildCommunityExploreContentProjection,
      retentionMs: module.COMMUNITY_EXPLORE_CONTENT_RETENTION_MS,
    };
  } catch (error) {
    throw new Error(
      [
        'Não foi possível carregar a projeção compilada.',
        'Execute "npm run functions:build" antes deste script.',
        error instanceof Error ? error.message : String(error),
      ].join(' ')
    );
  }
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Execução real exige COMMUNITY_EXPLORE_CONTENT_BACKFILL_CONFIRM=true.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const { build, retentionMs } = await loadProjectionBuilder();
  const now = Date.now();
  const cutoff = Timestamp.fromMillis(now - retentionMs);

  let cursor = null;
  let scannedCommunities = 0;
  let scannedPosts = 0;
  let eligible = 0;
  let written = 0;
  let pages = 0;
  let scanComplete = false;

  while (scannedCommunities < maxCommunities) {
    const remaining = maxCommunities - scannedCommunities;
    const currentLimit = Math.min(pageSize, remaining);
    let query = db
      .collection('community_discovery_index')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const communities = await query.get();
    if (communities.empty) {
      scanComplete = true;
      break;
    }

    pages += 1;
    cursor = communities.docs.at(-1);
    scannedCommunities += communities.size;

    for (const communityDocument of communities.docs) {
      const communityId = communityDocument.id;
      const feedSnapshot = await db
        .collection('community_public_feed')
        .doc(communityId)
        .collection('items')
        .where('publishedAt', '>=', cutoff)
        .orderBy('publishedAt', 'desc')
        .limit(postsPerCommunity)
        .get();

      if (feedSnapshot.empty) continue;
      scannedPosts += feedSnapshot.size;

      const operationalRefs = feedSnapshot.docs.map((postDocument) =>
        db
          .collection('community_feed_posts')
          .doc(communityId)
          .collection('items')
          .doc(postDocument.id)
      );
      const operationalSnapshots = await db.getAll(...operationalRefs);
      const projections = feedSnapshot.docs.flatMap((postDocument, index) => {
        const operationalSnapshot = operationalSnapshots[index];
        const projection = build({
          communityId,
          postId: postDocument.id,
          discovery: communityDocument.data(),
          feed: postDocument.data(),
          operationalPost: operationalSnapshot?.exists
            ? operationalSnapshot.data()
            : null,
          now,
        });

        return projection ? [projection] : [];
      });

      eligible += projections.length;
      if (dryRun || projections.length === 0) continue;

      const batch = db.batch();
      for (const projection of projections) {
        batch.set(
          db
            .collection('community_explore_content_index')
            .doc(`${projection.communityId}:${projection.postId}`),
          projection
        );
      }
      await batch.commit();
      written += projections.length;
    }

    console.log('[community-explore-content] scan', {
      pages,
      scannedCommunities,
      scannedPosts,
      eligible,
      written,
      dryRun,
    });

    if (communities.size < currentLimit) {
      scanComplete = true;
      break;
    }
  }

  console.log('[community-explore-content] completed', {
    projectId,
    dryRun,
    confirmed,
    pageSize,
    maxCommunities,
    postsPerCommunity,
    scannedCommunities,
    scannedPosts,
    eligible,
    written,
    scanComplete,
  });

  if (!scanComplete && scannedCommunities >= maxCommunities) {
    console.warn(
      '[community-explore-content] scan truncado pelo limite configurado.'
    );
  }
}

main().catch((error) => {
  console.error('[community-explore-content] failed', error);
  process.exitCode = 1;
});
