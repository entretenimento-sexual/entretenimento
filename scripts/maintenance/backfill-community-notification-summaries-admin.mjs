// scripts/maintenance/backfill-community-notification-summaries-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DE RESUMOS MULTI-COMUNIDADE
// -----------------------------------------------------------------------------
// Reprocessa notificações não lidas já existentes sem recalcular contadores no
// cliente. O script apenas toca documentos elegíveis; o trigger canônico
// `syncCommunityNotificationSummary` relê a notificação atual e converge a
// projeção/estado de forma idempotente.
//
// IMPORTANTE: executar somente depois que o trigger estiver implantado.
// Dry-run é o padrão e não grava nada.
//
// PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:BACKFILL_DRY_RUN='true'
// $env:BACKFILL_PAGE_SIZE='400'
// node scripts/maintenance/backfill-community-notification-summaries-admin.mjs
// -----------------------------------------------------------------------------

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const dryRun = String(process.env.BACKFILL_DRY_RUN || 'true').toLowerCase() !== 'false';
const requestedPageSize = Number.parseInt(
  String(process.env.BACKFILL_PAGE_SIZE || '400'),
  10
);
const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(450, requestedPageSize))
  : 400;

const COMMUNITY_NOTIFICATION_TYPES = new Set([
  'community.comment.received',
  'community.comment.reply.received',
  'community.content.moderated',
]);

function initializeAdmin() {
  if (getApps().length) return;

  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

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

function isEligibleNotification(data) {
  const type = String(data?.type ?? '').trim();
  const userId = String(data?.userId ?? '').trim();
  const communityId = String(data?.communityId ?? '').trim();

  return COMMUNITY_NOTIFICATION_TYPES.has(type)
    && Boolean(userId)
    && Boolean(communityId)
    && data?.readAt == null;
}

async function main() {
  initializeAdmin();
  const db = getFirestore();

  let cursor = null;
  let scanned = 0;
  let eligible = 0;
  let touched = 0;

  for (;;) {
    let pageQuery = db
      .collection('notifications')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (cursor) {
      pageQuery = pageQuery.startAfter(cursor);
    }

    const snapshot = await pageQuery.get();
    if (snapshot.empty) break;

    scanned += snapshot.size;
    const eligibleDocs = snapshot.docs.filter((document) =>
      isEligibleNotification(document.data())
    );
    eligible += eligibleDocs.length;

    if (!dryRun && eligibleDocs.length > 0) {
      const batch = db.batch();
      for (const document of eligibleDocs) {
        batch.update(document.ref, {
          communitySummaryProjectionBackfillVersion: 1,
          communitySummaryProjectionBackfillAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      touched += eligibleDocs.length;
    }

    cursor = snapshot.docs.at(-1)?.id ?? null;
    console.log('[backfill:community-notification-summaries] page', {
      scanned,
      eligible,
      touched,
      cursor,
      dryRun,
    });

    if (snapshot.size < pageSize || !cursor) break;
  }

  console.log('[backfill:community-notification-summaries] complete', {
    scanned,
    eligible,
    touched,
    dryRun,
  });
}

main().catch((error) => {
  console.error('[backfill:community-notification-summaries] failed', error);
  process.exitCode = 1;
});
