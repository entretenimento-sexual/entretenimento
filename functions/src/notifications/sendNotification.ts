// functions/src/notifications/sendNotification.ts
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {getFirestore} from 'firebase-admin/firestore';

import {
  isPushNotificationEnabledByPreference,
  resolvePushNotificationPreferenceKey,
} from './notification-preference.policy';
import {
  MAX_PUSH_DEVICES_PER_USER,
  resolveInvalidPushRegistryDocumentIds,
  resolvePushDeliveryTargets,
} from './push-device.policy';

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

    const userRef = db.collection('users').doc(recipientId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return;

    const devicesRef = userRef.collection('push_devices');
    const devicesSnapshot = await devicesRef
      .orderBy('lastSeenAt', 'desc')
      .limit(MAX_PUSH_DEVICES_PER_USER)
      .get();
    const targets = resolvePushDeliveryTargets(
      userDoc.data()?.fcmToken,
      devicesSnapshot.docs.map((device) => ({
        documentId: device.id,
        token: device.data()?.token,
      }))
    );

    if (targets.length === 0) return;

    const response = await getMessaging().sendEachForMulticast({
      tokens: targets.map((target) => target.token),
      notification: {
        title: notification.title,
        body: notification.body,
      },
    });
    const responseErrorCodes = response.responses.map((result) =>
      result.success ? null : toSafeErrorCode(result.error)
    );
    const invalidRegistryDocumentIds =
      resolveInvalidPushRegistryDocumentIds(targets, responseErrorCodes);

    if (invalidRegistryDocumentIds.length > 0) {
      try {
        const cleanupBatch = db.batch();
        for (const documentId of invalidRegistryDocumentIds) {
          cleanupBatch.delete(devicesRef.doc(documentId));
        }
        await cleanupBatch.commit();
      } catch (error) {
        // Limpeza é best-effort: não transformamos uma entrega já processada em
        // falha apenas porque a remoção de tokens inválidos ficou indisponível.
        console.error('[sendNotification] falha ao limpar tokens inválidos', {
          notificationId,
          notificationType,
          invalidTokenCount: invalidRegistryDocumentIds.length,
          errorCode: toSafeErrorCode(error),
        });
      }
    }

    console.info('[sendNotification] push processado', {
      notificationId,
      notificationType,
      targetCount: targets.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokenCount: invalidRegistryDocumentIds.length,
    });
  }
);

function toSafeErrorCode(error: unknown): string | null {
  const rawCode = (error as {code?: unknown} | null | undefined)?.code;
  if (typeof rawCode !== 'string') return null;

  const normalized = rawCode.trim();
  return normalized ? normalized.slice(0, 96) : null;
}
