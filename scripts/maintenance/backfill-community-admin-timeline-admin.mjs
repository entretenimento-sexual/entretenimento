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
const maxAudits = Math.max(
  1,
  Math.min(
    2_000_000,
    Number.parseInt(
      String(process.env.COMMUNITY_ADMIN_TIMELINE_MAX_AUDITS || '500000'),
      10
    ) || 500_000
  )
);

const SOURCES = [
  ['membership', 'community_membership_audit'],
  ['settings', 'community_settings_audit'],
  ['feed', 'community_feed_audit'],
  ['topic', 'community_topic_audit'],
  ['official', 'community_official_claim_audit'],
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
  collectionName,
  counters
) {
  let cursor = null;

  while (counters.scanned < maxAudits) {
    const remaining = maxAudits - counters.scanned;
    const currentLimit = Math.min(pageSize, remaining);
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) return;

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

    if (snapshot.size < currentLimit) return;
  }
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Escrita bloqueada: defina COMMUNITY_ADMIN_TIMELINE_CONFIRM=true.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const projectionModule = await loadProjectionModule();
  const counters = { scanned: 0, projected: 0, skipped: 0 };

  for (const [source, collectionName] of SOURCES) {
    if (counters.scanned >= maxAudits) break;
    await processSource(
      db,
      projectionModule,
      source,
      collectionName,
      counters
    );
  }

  console.log(JSON.stringify({
    projectId,
    dryRun,
    ...counters,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
