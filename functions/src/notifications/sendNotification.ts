// functions/src/notifications/sendNotification.ts
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {FieldValue, getFirestore, Timestamp} from 'firebase-admin/firestore';

import {
  isPushNotificationEnabledByPreference,
  resolvePushNotificationPreferenceKey,
} from './notification-preference.policy';
import {
  buildPushTokenDocumentId,
  isPushTokenOwnedByUid,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushToken,
  PUSH_TOKEN_OWNERS_COLLECTION,
  resolveInvalidPushDeliveryTargets,
  resolvePushDeliveryTargets,
  resolvePushDeviceFreshnessCutoffMs,
  shouldDeliverPushTokenToRecipient,
  shouldPruneCurrentPushToken,
} from './push-device.policy';
import {buildPrivatePushContent} from './push-notification-content.policy';
import {buildPushNotificationDeliveryOptions} from './push-notification-delivery.policy';
import {buildPushNotificationNavigationData} from './push-notification-navigation.policy';

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
    const navigationData = buildPushNotificationNavigationData(
      notification?.route,
      {
        type: notificationType,
        roomId: notification?.roomId,
      }
    );
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
    const freshnessCutoff = Timestamp.fromMillis(
      resolvePushDeviceFreshnessCutoffMs()
    );
    const devicesSnapshot = await devicesRef
      .where('lastSeenAt', '>=', freshnessCutoff)
      .orderBy('lastSeenAt', 'desc')
      .limit(MAX_PUSH_DEVICES_PER_USER)
      .get();
    const candidateTargets = resolvePushDeliveryTargets(
      userDoc.data()?.fcmToken,
      devicesSnapshot.docs.map((device) => ({
        documentId: device.id,
        token: device.data()?.token,
      }))
    );

    if (candidateTargets.length === 0) return;

    let targets = candidateTargets;

    try {
      const ownerRefs = candidateTargets.map((target) =>
        db
          .collection(PUSH_TOKEN_OWNERS_COLLECTION)
          .doc(buildPushTokenDocumentId(target.token))
      );
      const ownerSnapshots = await db.getAll(...ownerRefs);

      targets = candidateTargets.filter((_target, index) => {
        const ownerSnapshot = ownerSnapshots[index];

        return shouldDeliverPushTokenToRecipient(
          ownerSnapshot?.exists ?? false,
          ownerSnapshot?.exists ? ownerSnapshot.data() : undefined,
          recipientId
        );
      });
    } catch (error) {
      // A notificação in-app já existe. Se a autoridade global do token não
      // puder ser comprovada, o push externo falha fechado para preservar
      // privacidade entre contas que compartilharam a mesma instalação.
      console.error('[sendNotification] falha ao validar ownership de token', {
        notificationId,
        notificationType,
        candidateTargetCount: candidateTargets.length,
        errorCode: toSafeErrorCode(error),
      });
      return;
    }

    const ownershipFilteredCount = candidateTargets.length - targets.length;

    if (ownershipFilteredCount > 0) {
      console.warn('[sendNotification] alvos suprimidos por ownership canônico', {
        notificationId,
        notificationType,
        ownershipFilteredCount,
      });
    }

    if (targets.length === 0) return;

    const pushContent = buildPrivatePushContent();
    const deliveryOptions = buildPushNotificationDeliveryOptions();
    const response = await getMessaging().sendEachForMulticast({
      tokens: targets.map((target) => target.token),
      notification: pushContent,
      ...deliveryOptions,
      ...(navigationData ? {data: navigationData} : {}),
    });
    const responseErrorCodes = response.responses.map((result) =>
      result.success ? null : toSafeErrorCode(result.error)
    );
    const invalidTargets = resolveInvalidPushDeliveryTargets(
      targets,
      responseErrorCodes
    );
    let prunedRegistryDeviceCount = 0;
    let prunedLegacyToken = false;
    let prunedTokenOwnerCount = 0;

    if (invalidTargets.length > 0) {
      try {
        const invalidTokens = new Set(
          invalidTargets.map((target) => target.token)
        );
        const expectedTokenByDocumentId = new Map<string, string>();

        for (const target of invalidTargets) {
          for (const documentId of target.registryDocumentIds) {
            expectedTokenByDocumentId.set(documentId, target.token);
          }
        }

        const cleanupResult = await db.runTransaction(async (tx) => {
          const currentUserDoc = await tx.get(userRef);
          const deviceEntries = Array.from(expectedTokenByDocumentId.entries());
          const currentDevices = [];

          // Todas as leituras acontecem antes das escritas. Se um token rotacionar
          // durante a transação, o Firestore repete a operação com o estado novo.
          for (const [documentId] of deviceEntries) {
            currentDevices.push(await tx.get(devicesRef.doc(documentId)));
          }

          const invalidTokenList = Array.from(invalidTokens);
          const invalidOwnerRefs = invalidTokenList.map((token) =>
            db
              .collection(PUSH_TOKEN_OWNERS_COLLECTION)
              .doc(buildPushTokenDocumentId(token))
          );
          const currentOwners = [];

          for (const ownerRef of invalidOwnerRefs) {
            currentOwners.push(await tx.get(ownerRef));
          }

          let registryDeviceCount = 0;

          for (let index = 0; index < deviceEntries.length; index += 1) {
            const expectedInvalidToken = deviceEntries[index]?.[1];
            const currentDevice = currentDevices[index];

            if (
              !expectedInvalidToken ||
              !currentDevice?.exists ||
              !shouldPruneCurrentPushToken(
                currentDevice.data()?.token,
                expectedInvalidToken
              )
            ) {
              continue;
            }

            tx.delete(currentDevice.ref);
            registryDeviceCount += 1;
          }

          let tokenOwnerCount = 0;

          for (const currentOwner of currentOwners) {
            if (
              currentOwner.exists &&
              isPushTokenOwnedByUid(currentOwner.data(), recipientId)
            ) {
              tx.delete(currentOwner.ref);
              tokenOwnerCount += 1;
            }
          }

          const currentLegacyToken = normalizePushToken(
            currentUserDoc.data()?.fcmToken
          );
          const removeLegacyToken = Boolean(
            currentUserDoc.exists &&
            currentLegacyToken &&
            invalidTokens.has(currentLegacyToken)
          );

          if (removeLegacyToken) {
            tx.update(userRef, {
              fcmToken: FieldValue.delete(),
            });
          }

          return {
            registryDeviceCount,
            legacyTokenRemoved: removeLegacyToken,
            tokenOwnerCount,
          };
        });

        prunedRegistryDeviceCount = cleanupResult.registryDeviceCount;
        prunedLegacyToken = cleanupResult.legacyTokenRemoved;
        prunedTokenOwnerCount = cleanupResult.tokenOwnerCount;
      } catch (error) {
        // Limpeza é best-effort: não transformamos uma entrega já processada em
        // falha apenas porque a remoção de tokens inválidos ficou indisponível.
        console.error('[sendNotification] falha ao limpar tokens inválidos', {
          notificationId,
          notificationType,
          invalidTokenCount: invalidTargets.length,
          errorCode: toSafeErrorCode(error),
        });
      }
    }

    console.info('[sendNotification] push processado', {
      notificationId,
      notificationType,
      hasNavigationRoute: Boolean(navigationData),
      usesNeutralExternalContent: true,
      targetsFreshRegistryOnly: true,
      validatesCanonicalTokenOwnership: true,
      hasExplicitDeliveryTtl: true,
      candidateTargetCount: candidateTargets.length,
      ownershipFilteredCount,
      targetCount: targets.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokenCount: invalidTargets.length,
      prunedRegistryDeviceCount,
      prunedLegacyToken,
      prunedTokenOwnerCount,
    });
  }
);

function toSafeErrorCode(error: unknown): string | null {
  const rawCode = (error as {code?: unknown} | null | undefined)?.code;
  if (typeof rawCode !== 'string') return null;

  const normalized = rawCode.trim();
  return normalized ? normalized.slice(0, 96) : null;
}
