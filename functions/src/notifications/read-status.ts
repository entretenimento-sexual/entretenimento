import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp } from '../firebaseApp';
import {
  MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
  MARK_ALL_NOTIFICATIONS_MAX_BATCHES,
  resolveMarkAllNotificationsReadBatchPlan,
  shouldResetGroupedCommunityActivityCount,
} from './read-status.policy';

interface MarkNotificationReadRequest {
  notificationId?: unknown;
}

interface MarkAllNotificationsReadResponse {
  updated: number;
  complete: boolean;
}

interface NotificationReadState {
  userId?: unknown;
  readAt?: unknown;
  type?: unknown;
}

function getUid(value: unknown): string {
  return String(value ?? '').trim();
}

function getNotificationId(value: unknown): string {
  const notificationId = String(value ?? '').trim();

  if (!notificationId || notificationId.length > 160 || notificationId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Notificação inválida.');
  }

  return notificationId;
}

function buildReadPatch(notification: NotificationReadState): Record<string, unknown> {
  const now = FieldValue.serverTimestamp();

  return {
    readAt: now,
    updatedAt: now,
    ...(shouldResetGroupedCommunityActivityCount(notification.type)
      ? { activityCount: 0 }
      : {}),
  };
}

export const markNotificationRead = onCall<MarkNotificationReadRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ ok: true }> => {
    const uid = getUid(request.auth?.uid);

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const notificationId = getNotificationId(request.data?.notificationId);
    const notificationRef = db.collection('notifications').doc(notificationId);

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(notificationRef);

      if (!snapshot.exists) {
        throw new HttpsError('not-found', 'Notificação não encontrada.');
      }

      const notification = snapshot.data() as NotificationReadState;

      if (notification.userId !== uid) {
        throw new HttpsError('permission-denied', 'Notificação não pertence ao usuário.');
      }

      if (notification.readAt != null) {
        return;
      }

      tx.set(notificationRef, buildReadPatch(notification), { merge: true });
    });

    return { ok: true };
  }
);

export const markAllNotificationsRead = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<MarkAllNotificationsReadResponse> => {
    const uid = getUid(request.auth?.uid);

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    // O corte é fixado no início da ação. Em ordem decrescente, startAt(cutoffAt)
    // exclui notificações criadas depois do clique do usuário, evitando que uma
    // operação longa consuma atividade nova que chegou durante o processamento.
    const cutoffAt = Timestamp.now();
    let updated = 0;

    for (
      let batchNumber = 1;
      batchNumber <= MARK_ALL_NOTIFICATIONS_MAX_BATCHES;
      batchNumber += 1
    ) {
      // Busca um documento além do tamanho gravável como sentinela. Assim sabemos
      // se ainda há pendências sem executar uma consulta adicional de contagem.
      const snapshot = await db
        .collection('notifications')
        .where('userId', '==', uid)
        .where('readAt', '==', null)
        .orderBy('createdAt', 'desc')
        .startAt(cutoffAt)
        .limit(MARK_ALL_NOTIFICATIONS_BATCH_SIZE + 1)
        .get();
      const plan = resolveMarkAllNotificationsReadBatchPlan({
        fetchedCount: snapshot.size,
        batchNumber,
      });

      if (plan.writeCount === 0) {
        return { updated, complete: true };
      }

      const batch = db.batch();

      snapshot.docs.slice(0, plan.writeCount).forEach((docSnapshot) => {
        batch.set(
          docSnapshot.ref,
          buildReadPatch(docSnapshot.data() as NotificationReadState),
          { merge: true }
        );
      });

      await batch.commit();
      updated += plan.writeCount;

      if (!plan.hasMore) {
        return { updated, complete: true };
      }

      if (!plan.shouldContinue) {
        return { updated, complete: false };
      }
    }

    return { updated, complete: false };
  }
);
