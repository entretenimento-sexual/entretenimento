// functions/src/presence/clearStalePresence.ts
// Limpa presencas online que deixaram de receber atualizacoes dentro da janela.
// A funcao preserva lastSeen como o ultimo registro real do usuario e grava
// somente o estado offline e os campos de auditoria da limpeza.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp } from '../firebaseApp';

import type {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  WriteBatch,
} from 'firebase-admin/firestore';

const WINDOW_SEC = Number(process.env.PRESENCE_WINDOW_SEC || '120');
const MAX_BATCH_OPS = 450;
const PAGE_SIZE = 1000;

export const clearStalePresence = onSchedule(
  {
    schedule: 'every 2 minutes',
    region: FUNCTIONS_REGION,
    memory: '256MiB',
  },
  async () => {
    const cutoffTs = Timestamp.fromMillis(Date.now() - WINDOW_SEC * 1000);
    const baseQuery: Query<DocumentData> = db
      .collection('presence')
      .where('isOnline', '==', true)
      .where('lastSeen', '<', cutoffTs)
      .orderBy('lastSeen', 'asc')
      .limit(PAGE_SIZE);

    let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
    let shouldContinue = true;

    try {
      while (shouldContinue) {
        let pageQuery: Query<DocumentData> = baseQuery;

        if (lastDoc) {
          pageQuery = pageQuery.startAfter(lastDoc);
        }

        const snapshot: QuerySnapshot<DocumentData> = await pageQuery.get();

        if (snapshot.empty) {
          shouldContinue = false;
          continue;
        }

        let batch: WriteBatch = db.batch();
        let operations = 0;

        for (const documentSnapshot of snapshot.docs) {
          batch.update(documentSnapshot.ref, {
            isOnline: false,
            presenceState: 'offline',
            staleClearedAt: FieldValue.serverTimestamp(),
            offlineReason: 'stale',
          });

          operations++;

          if (operations >= MAX_BATCH_OPS) {
            await safeCommit(batch, operations);
            batch = db.batch();
            operations = 0;
          }
        }

        if (operations > 0) {
          await safeCommit(batch, operations);
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
        shouldContinue = snapshot.size === PAGE_SIZE && lastDoc !== null;
      }
    } catch (error) {
      console.error('[clearStalePresence] fatal error:', error);
    }
  }
);

async function safeCommit(batch: WriteBatch, operations: number): Promise<void> {
  try {
    await batch.commit();
  } catch (error) {
    console.error(
      `[clearStalePresence] batch commit failed (ops=${operations})`,
      error
    );
  }
}
