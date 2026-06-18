import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';

const MAX_BATCH_SIZE = 50;

interface MarkNotificationReadRequest {
  notificationId?: unknown;
}

interface MarkAllNotificationsReadResponse {
  updated: number;
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

      const notification = snapshot.data() as { userId?: unknown; readAt?: unknown };

      if (notification.userId !== uid) {
        throw new HttpsError('permission-denied', 'Notificação não pertence ao usuário.');
      }

      if (notification.readAt != null) {
        return;
      }

      tx.set(notificationRef, {
        readAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
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

    const snapshot = await db
      .collection('notifications')
      .where('userId', '==', uid)
      .where('readAt', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(MAX_BATCH_SIZE)
      .get();

    if (snapshot.empty) {
      return { updated: 0 };
    }

    const batch = db.batch();
    const now = FieldValue.serverTimestamp();

    snapshot.docs.forEach((docSnapshot) => {
      batch.set(docSnapshot.ref, {
        readAt: now,
        updatedAt: now,
      }, { merge: true });
    });

    await batch.commit();

    return { updated: snapshot.size };
  }
);
