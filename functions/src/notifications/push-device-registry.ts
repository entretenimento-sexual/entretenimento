import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildPushInstallationDocumentId,
  buildPushTokenDocumentId,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushInstallationId,
  normalizePushToken,
  resolvePushDevicePlatform,
} from './push-device.policy';

interface PushDeviceRequest {
  token?: unknown;
  platform?: unknown;
  installationId?: unknown;
}

interface PushDeviceDocument {
  token?: unknown;
  platform?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastSeenAt?: unknown;
  schemaVersion?: unknown;
}

function requireUid(value: unknown): string {
  const uid = String(value ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  return uid;
}

function requireToken(value: unknown): string {
  const token = normalizePushToken(value);

  if (!token) {
    throw new HttpsError('invalid-argument', 'Token de notificação inválido.');
  }

  return token;
}

function requireInstallationId(value: unknown): string {
  const installationId = normalizePushInstallationId(value);

  if (!installationId) {
    throw new HttpsError(
      'invalid-argument',
      'Identificador da instalação inválido.'
    );
  }

  return installationId;
}

function requirePlatform(value: unknown) {
  const platform = resolvePushDevicePlatform(value);

  if (!platform) {
    throw new HttpsError('invalid-argument', 'Plataforma do dispositivo inválida.');
  }

  return platform;
}

export const registerPushDevice = onCall<PushDeviceRequest>(
  { region: FUNCTIONS_REGION, enforceAppCheck: true },
  async (request): Promise<{ ok: true }> => {
    const uid = requireUid(request.auth?.uid);
    const token = requireToken(request.data?.token);
    const platform = requirePlatform(request.data?.platform);
    const installationId = requireInstallationId(request.data?.installationId);
    const installationDocumentId =
      buildPushInstallationDocumentId(installationId);
    const legacyTokenDocumentId = buildPushTokenDocumentId(token);
    const userRef = db.collection('users').doc(uid);
    const devicesRef = userRef.collection('push_devices');
    const deviceRef = devicesRef.doc(installationDocumentId);

    await db.runTransaction(async (tx) => {
      const userSnapshot = await tx.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
      }

      const devicesSnapshot = await tx.get(
        devicesRef
          .orderBy('lastSeenAt', 'asc')
          .limit(MAX_PUSH_DEVICES_PER_USER + 1)
      );
      const existingDevice = devicesSnapshot.docs.find(
        (snapshot) => snapshot.id === installationDocumentId
      );
      const duplicateTokenDevices = devicesSnapshot.docs.filter(
        (snapshot) =>
          snapshot.id !== installationDocumentId &&
          normalizePushToken(snapshot.data()?.token) === token
      );
      const now = FieldValue.serverTimestamp();
      const current = existingDevice?.data() as PushDeviceDocument | undefined;
      const migratedLegacy = duplicateTokenDevices.find(
        (snapshot) => snapshot.id === legacyTokenDocumentId
      )?.data() as PushDeviceDocument | undefined;
      const legacyUserToken = normalizePushToken(
        userSnapshot.data()?.fcmToken
      );

      for (const duplicate of duplicateTokenDevices) {
        tx.delete(duplicate.ref);
      }

      const sizeAfterDeduplication =
        devicesSnapshot.size - duplicateTokenDevices.length;
      const projectedSize = sizeAfterDeduplication + (existingDevice ? 0 : 1);
      const overflowCount = Math.max(
        0,
        projectedSize - MAX_PUSH_DEVICES_PER_USER
      );

      if (overflowCount > 0) {
        const removableDevices = devicesSnapshot.docs.filter(
          (snapshot) =>
            snapshot.id !== installationDocumentId &&
            !duplicateTokenDevices.some(
              (duplicate) => duplicate.id === snapshot.id
            )
        );

        for (const staleDevice of removableDevices.slice(0, overflowCount)) {
          tx.delete(staleDevice.ref);
        }
      }

      tx.set(
        deviceRef,
        {
          token,
          platform,
          schemaVersion: 2,
          createdAt: current?.createdAt ?? migratedLegacy?.createdAt ?? now,
          updatedAt: now,
          lastSeenAt: now,
        },
        { merge: true }
      );

      // O user.fcmToken v1 permanece como fallback apenas enquanto não houver
      // prova de que esta mesma instalação já migrou. Se o token coincidir,
      // a registry v2 passa a ser a única fonte para evitar tentativas órfãs.
      if (legacyUserToken === token) {
        tx.update(userRef, {
          fcmToken: FieldValue.delete(),
        });
      }
    });

    return { ok: true };
  }
);

export const unregisterPushDevice = onCall<PushDeviceRequest>(
  { region: FUNCTIONS_REGION, enforceAppCheck: true },
  async (request): Promise<{ ok: true }> => {
    const uid = requireUid(request.auth?.uid);
    const installationId = requireInstallationId(request.data?.installationId);
    const installationDocumentId =
      buildPushInstallationDocumentId(installationId);
    const requestedToken = normalizePushToken(request.data?.token);
    const userRef = db.collection('users').doc(uid);
    const devicesRef = userRef.collection('push_devices');
    const deviceRef = devicesRef.doc(installationDocumentId);

    await db.runTransaction(async (tx) => {
      const userSnapshot = await tx.get(userRef);
      const deviceSnapshot = await tx.get(deviceRef);
      const registeredToken = normalizePushToken(
        deviceSnapshot.data()?.token
      );
      const tokensToRemove = new Set(
        [requestedToken, registeredToken].filter(
          (token): token is string => token !== null
        )
      );

      tx.delete(deviceRef);

      for (const token of tokensToRemove) {
        const legacyTokenDocumentId = buildPushTokenDocumentId(token);
        if (legacyTokenDocumentId !== installationDocumentId) {
          tx.delete(devicesRef.doc(legacyTokenDocumentId));
        }
      }

      const legacyUserToken = normalizePushToken(
        userSnapshot.data()?.fcmToken
      );

      if (legacyUserToken && tokensToRemove.has(legacyUserToken)) {
        tx.update(userRef, {
          fcmToken: FieldValue.delete(),
        });
      }
    });

    return { ok: true };
  }
);
