// functions/src/notifications/sendNotification.ts
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {getFirestore} from 'firebase-admin/firestore';

import {
  isPushNotificationEnabledByPreference,
  resolvePushNotificationPreferenceKey,
} from './notification-preference.policy';

export const sendNotification = onDocumentCreated(
  'notifications/{notificationId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const notification = snap.data();
    const recipientId = String(notification?.userId ?? '').trim();
    if (!recipientId) return;

    const notificationId = String(event.params.notificationId ?? '').trim();
    const notificationType = String(notification?.type ?? '').trim();
    const preferenceKey = resolvePushNotificationPreferenceKey(notificationType);
    const db = getFirestore();

    if (preferenceKey) {
      try {
        const preferenceDoc = await db
          .collection('preferences')
          .doc(recipientId)
          .get();
        const pushEnabled = isPushNotificationEnabledByPreference(
          preferenceKey,
          preferenceDoc.data()?.notificationPreferences
        );

        if (!pushEnabled) {
          console.info('[sendNotification] push suprimido por preferência', {
            notificationId,
            notificationType,
            preferenceKey,
          });
          return;
        }
      } catch (error) {
        // Push opcional falha fechado: a notificação in-app já foi persistida e
        // não arriscamos ignorar uma preferência de privacidade por indisponibilidade.
        console.error('[sendNotification] falha ao ler preferência de push', {
          notificationId,
          notificationType,
          preferenceKey,
          errorCode: toSafeErrorCode(error),
        });
        return;
      }
    }

    const userDoc = await db.collection('users').doc(recipientId).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) return;

    await getMessaging().send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
    });

    console.info('[sendNotification] push enviado', {
      notificationId,
      notificationType,
    });
  }
);

function toSafeErrorCode(error: unknown): string | null {
  const rawCode = (error as {code?: unknown} | null | undefined)?.code;
  if (typeof rawCode !== 'string') return null;

  const normalized = rawCode.trim();
  return normalized ? normalized.slice(0, 96) : null;
}
