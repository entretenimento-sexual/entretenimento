// scripts/maintenance/backfill-community-notification-global-summary-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DO RESUMO GLOBAL DE NOTIFICAÇÕES DE COMUNIDADES
// -----------------------------------------------------------------------------
// Dry-run por padrão. O runtime novo mantém O(1) depois da migração; este script
// faz a única leitura O(N) necessária para converter o legado já existente.
//
// PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_DRY_RUN='true'
// npm run maintenance:community-notification-global-summary
//
// Execução real, somente após deploy das Functions escritoras e antes do frontend:
// $env:COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_DRY_RUN='false'
// $env:COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_CONFIRM='true'
// npm run maintenance:community-notification-global-summary
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
  String(
    process.env.COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_DRY_RUN || 'true'
  ).trim().toLowerCase() !== 'false';
const confirmed =
  String(
    process.env.COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_CONFIRM || 'false'
  ).trim().toLowerCase() === 'true';

const requestedUserPageSize = Number.parseInt(
  String(
    process.env.COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_USER_PAGE_SIZE || '100'
  ),
  10
);
const requestedItemPageSize = Number.parseInt(
  String(
    process.env.COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_ITEM_PAGE_SIZE || '300'
  ),
  10
);
const requestedMaxUsers = Number.parseInt(
  String(
    process.env.COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_MAX_USERS || '10000'
  ),
  10
);

const userPageSize = Number.isFinite(requestedUserPageSize)
  ? Math.max(1, Math.min(300, requestedUserPageSize))
  : 100;
const itemPageSize = Number.isFinite(requestedItemPageSize)
  ? Math.max(1, Math.min(400, requestedItemPageSize))
  : 300;
const maxUsers = Number.isFinite(requestedMaxUsers)
  ? Math.max(1, Math.min(1_000_000, requestedMaxUsers))
  : 10_000;

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
      '../../functions/lib/community/community-notification-global-summary.policy.js'
    );

    if (
      typeof module.normalizeCommunityNotificationSummaryItem !== 'function'
      || typeof module.buildCommunityNotificationAttentionWindow !== 'function'
      || !Number.isFinite(module.COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION)
    ) {
      throw new Error('Policy compilada do resumo global não encontrada.');
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

async function readUserItems(db, uid, policy) {
  const collection = db
    .collection('community_notification_summaries')
    .doc(uid)
    .collection('items');

  let cursor = null;
  let scanComplete = false;
  const items = [];
  const repairs = [];

  while (!scanComplete) {
    let query = collection
      .orderBy(FieldPath.documentId())
      .limit(itemPageSize);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) {
      scanComplete = true;
      break;
    }

    cursor = snapshot.docs.at(-1);

    for (const document of snapshot.docs) {
      const normalized = policy.normalizeCommunityNotificationSummaryItem(
        document.id,
        document.data()
      );
      if (!normalized) continue;

      items.push(normalized);

      const currentRank = Number(document.data()?.attentionRank);
      if (
        !Number.isFinite(currentRank)
        || Math.trunc(currentRank) !== normalized.attentionRank
      ) {
        repairs.push({
          ref: document.ref,
          attentionRank: normalized.attentionRank,
        });
      }
    }

    if (snapshot.size < itemPageSize) {
      scanComplete = true;
    }
  }

  return { items, repairs, scanComplete };
}

async function writeUserProjection(db, uid, items, repairs, policy) {
  const unreadCount = items.reduce(
    (total, item) => total + item.unreadCount,
    0
  );
  const priorityUnreadCount = items.reduce(
    (total, item) => total + item.priorityUnreadCount,
    0
  );
  const priorityCommunityCount = items.filter(
    (item) => item.hasPriorityUnread
  ).length;
  const attentionWindow = policy.buildCommunityNotificationAttentionWindow({
    candidates: items,
    changes: [],
  });
  const now = Timestamp.now();

  const writes = [
    ...repairs.map((repair) => ({
      ref: repair.ref,
      data: { attentionRank: repair.attentionRank },
      merge: true,
    })),
    {
      ref: db.collection('community_notification_summaries').doc(uid),
      data: {
        projectionVersion:
          policy.COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION,
        requiresBackfill: false,
        unreadCount,
        priorityUnreadCount,
        unreadCommunityCount: items.length,
        priorityCommunityCount,
        hasPriorityUnread: priorityUnreadCount > 0,
        attentionWindow: attentionWindow.map((item) => ({
          communityId: item.communityId,
          unreadCount: item.unreadCount,
          priorityUnreadCount: item.priorityUnreadCount,
          hasPriorityUnread: item.hasPriorityUnread,
          updatedAt: item.updatedAtMs > 0
            ? Timestamp.fromMillis(item.updatedAtMs)
            : now,
        })),
        updatedAt: now,
      },
      merge: true,
    },
  ];

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) {
      batch.set(write.ref, write.data, { merge: write.merge });
    }
    await batch.commit();
  }

  return {
    unreadCount,
    priorityUnreadCount,
    priorityCommunityCount,
    attentionWindowSize: attentionWindow.length,
    writes: writes.length,
  };
}

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error(
      'Execução real exige COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_CONFIRM=true.'
    );
  }

  initializeAdmin();
  const db = getFirestore();
  const policy = await loadPolicy();

  let cursor = null;
  let scannedUsers = 0;
  let usersWithSummaries = 0;
  let scannedSummaryItems = 0;
  let itemRepairsNeeded = 0;
  let usersWritten = 0;
  let writesCommitted = 0;
  let pages = 0;
  let scanComplete = false;

  while (scannedUsers < maxUsers) {
    const remaining = maxUsers - scannedUsers;
    const currentLimit = Math.min(userPageSize, remaining);
    let query = db
      .collection('users')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) query = query.startAfter(cursor);

    const users = await query.get();
    if (users.empty) {
      scanComplete = true;
      break;
    }

    pages += 1;
    scannedUsers += users.size;
    cursor = users.docs.at(-1);

    for (const userDocument of users.docs) {
      const uid = userDocument.id;
      const result = await readUserItems(db, uid, policy);
      if (!result.scanComplete) {
        throw new Error(`Scan incompleto de summaries para ${uid}.`);
      }

      scannedSummaryItems += result.items.length;
      itemRepairsNeeded += result.repairs.length;

      if (result.items.length === 0) continue;
      usersWithSummaries += 1;

      if (!dryRun) {
        const writeResult = await writeUserProjection(
          db,
          uid,
          result.items,
          result.repairs,
          policy
        );
        usersWritten += 1;
        writesCommitted += writeResult.writes;
      }
    }

    console.log('[community-notification-global-summary] scan', {
      pages,
      scannedUsers,
      usersWithSummaries,
      scannedSummaryItems,
      itemRepairsNeeded,
      usersWritten,
      writesCommitted,
      dryRun,
    });

    if (users.size < currentLimit) {
      scanComplete = true;
      break;
    }
  }

  const summary = {
    projectId,
    dryRun,
    confirmed,
    userPageSize,
    itemPageSize,
    maxUsers,
    scannedUsers,
    usersWithSummaries,
    scannedSummaryItems,
    itemRepairsNeeded,
    usersWritten,
    writesCommitted,
    pages,
    scanComplete,
    truncatedByMaxUsers: !scanComplete && scannedUsers >= maxUsers,
  };

  console.log('[community-notification-global-summary] completed', summary);

  if (!dryRun && !scanComplete) {
    throw new Error(
      'Scan incompleto. Aumente COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_MAX_USERS.'
    );
  }
}

main().catch((error) => {
  console.error('[community-notification-global-summary] failed', {
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  });
  process.exitCode = 1;
});
