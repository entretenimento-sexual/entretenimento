// scripts/maintenance/backfill-community-admin-timeline-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DA LINHA DO TEMPO ADMINISTRATIVA
// -----------------------------------------------------------------------------
// Dry-run por padrão. A projeção é derivada e descartável.
// Escrita real exige confirmação dupla e só deve ocorrer após os triggers.
// -----------------------------------------------------------------------------

import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();
const dryRun =
  String(process.env.COMMUNITY_ADMIN_TIMELINE_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';
const confirmed =
  String(process.env.COMMUNITY_ADMIN_TIMELINE_CONFIRM || 'false')
    .trim()
    .toLowerCase() === 'true';
const pageSize = Math.max(
  1,
  Math.min(
    300,
    Number.parseInt(
      String(process.env.COMMUNITY_ADMIN_TIMELINE_PAGE_SIZE || '200'),
      10
    ) || 200
  )
);
const maxAuditsPerSource = Math.max(
  1,
  Math.min(
    2_000_000,
    Number.parseInt(
      String(
        process.env.COMMUNITY_ADMIN_TIMELINE_MAX_AUDITS_PER_SOURCE
        || process.env.COMMUNITY_ADMIN_TIMELINE_MAX_AUDITS
        || '500000'
      ),
      10
    ) || 500_000
  )
);
const sourceFilter = String(
  process.env.COMMUNITY_ADMIN_TIMELINE_SOURCE || ''
).trim();

const SOURCES = [
  ['membership', 'community_membership_audit'],
  ['settings', 'community_settings_audit'],
  ['highlight', 'community_highlight_audit'],
  ['feed', 'community_feed_audit'],
  ['topic', 'community_topic_audit'],
  ['official', 'community_official_claim_audit'],
  ['official_association', 'community_official_association_audit'],
  ['lifecycle', 'community_lifecycle_audit'],
];

function initializeAdmin() {
  if (getApps().length) return;
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

async function loadProjectionModule() {
  try {
    const module = await import(
      '../../functions/lib/community/community-admin-timeline.projection.js'
    );

    if (
      typeof module.buildCommunityAdminTimelineProjection !== 'function'
      || typeof module.buildCommunityAdminTimelineProjectionId !== 'function'
    ) {
      throw new Error('Projeção canônica da timeline não encontrada.');
    }

    return module;
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

async function processSource(
  db,
  projectionModule,
  source,
  collectionName
) {
  let cursor = null;
  const counters = { scanned: 0, projected: 0, skipped: 0 };

  while (counters.scanned < maxAuditsPerSource) {
    const remaining = maxAuditsPerSource - counters.scanned;
    const currentLimit = Math.min(pageSize, remaining);
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) return counters;

    cursor = snapshot.docs.at(-1);
    counters.scanned += snapshot.size;
    const writes = [];

    for (const document of snapshot.docs) {
      const projection =
        projectionModule.buildCommunityAdminTimelineProjection({
          source,
          auditId: document.id,
          rawAudit: document.data(),
        });

      if (!projection) {
        counters.skipped += 1;
        continue;
      }

      counters.projected += 1;
      const id = projectionModule.buildCommunityAdminTimelineProjectionId(
        source,
        document.id
      );
      writes.push({
        ref: db
          .collection('community_admin_timeline')
          .doc(projection.communityId)
          .collection('items')
          .doc(id),
        projection,
      });
    }

    if (!dryRun && writes.length > 0) {
      for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = db.batch();

        for (const write of writes.slice(offset, offset + 400)) {
          batch.set(write.ref, {
            ...write.projection,
            projectedAtMs: Date.now(),
          });
        }

        await batch.commit();
      }
    }

    if (snapshot.size < currentLimit) return counters;
  }

  return counters;
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Escrita bloqueada: defina COMMUNITY_ADMIN_TIMELINE_CONFIRM=true.'
    );
  }

  const availableSources = new Set(SOURCES.map(([source]) => source));
  if (sourceFilter && !availableSources.has(sourceFilter)) {
    throw new Error(
      `Fonte inválida em COMMUNITY_ADMIN_TIMELINE_SOURCE: ${sourceFilter}.`
    );
  }
  if (!dryRun && !sourceFilter) {
    throw new Error(
      'Backfill real exige COMMUNITY_ADMIN_TIMELINE_SOURCE para executar uma fonte por vez.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const projectionModule = await loadProjectionModule();
  const selectedSources = sourceFilter
    ? SOURCES.filter(([source]) => source === sourceFilter)
    : SOURCES;
  const counters = { scanned: 0, projected: 0, skipped: 0 };
  const bySource = {};

  for (const [source, collectionName] of selectedSources) {
    const sourceCounters = await processSource(
      db,
      projectionModule,
      source,
      collectionName
    );
    bySource[source] = sourceCounters;
    counters.scanned += sourceCounters.scanned;
    counters.projected += sourceCounters.projected;
    counters.skipped += sourceCounters.skipped;
  }

  console.log(JSON.stringify({
    projectId,
    dryRun,
    sourceFilter: sourceFilter || null,
    maxAuditsPerSource,
    ...counters,
    bySource,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
