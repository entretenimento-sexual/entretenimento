import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildPushInstallationDocumentId,
  buildPushTokenDocumentId,
  isCanonicalPushTokenOwner,
  isPushDeviceRegistrationFresh,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushInstallationId,
  normalizePushToken,
  PUSH_TOKEN_OWNERS_COLLECTION,
  PUSH_TOKEN_OWNER_SCHEMA_VERSION,
  resolvePushDevicePlatform,
  shouldReleasePushTokenOwner,
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
    const tokenDocumentId = buildPushTokenDocumentId(token);
    const userRef = db.collection('users').doc(uid);
    const devicesRef = userRef.collection('push_devices');
    const deviceRef = devicesRef.doc(installationDocumentId);
    const tokenOwnerRef = db
      .collection(PUSH_TOKEN_OWNERS_COLLECTION)
      .doc(tokenDocumentId);
    const observedAtMs = Date.now();

    await db.runTransaction(async (tx) => {
      const userSnapshot = await tx.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
      }

      // Fast path: um bootstrap recorrente do mesmo navegador não precisa ler
      // toda a registry nem regravar lastSeenAt, mas somente quando a autoridade
      // global do token confirma a mesma instalação e o mesmo usuário.
      const deviceSnapshot = await tx.get(deviceRef);
      const tokenOwnerSnapshot = await tx.get(tokenOwnerRef);
      const current = deviceSnapshot.exists
        ? (deviceSnapshot.data() as PushDeviceDocument)
        : undefined;
      const currentToken = normalizePushToken(current?.token);

      if (
        isPushDeviceRegistrationFresh(
          current,
          token,
          platform,
          observedAtMs
        ) &&
        tokenOwnerSnapshot.exists &&
        isCanonicalPushTokenOwner(
          tokenOwnerSnapshot.data(),
          uid,
          installationDocumentId
        )
      ) {
        return;
      }

      const previousTokenOwnerSnapshot =
        currentToken && currentToken !== token
          ? await tx.get(
            db
              .collection(PUSH_TOKEN_OWNERS_COLLECTION)
              .doc(buildPushTokenDocumentId(currentToken))
          )
          : null;
      const devicesSnapshot = await tx.get(
        devicesRef
          .orderBy('lastSeenAt', 'asc')
          .limit(MAX_PUSH_DEVICES_PER_USER + 1)
      );
      const existingDevice = deviceSnapshot.exists
        ? deviceSnapshot
        : devicesSnapshot.docs.find(
          (snapshot) => snapshot.id === installationDocumentId
        );
      const duplicateTokenDevices = devicesSnapshot.docs.filter(
        (snapshot) =>
          snapshot.id !== installationDocumentId &&
          normalizePushToken(snapshot.data()?.token) === token
      );
      const now = FieldValue.serverTimestamp();
      const currentForWrite = existingDevice?.data() as
        | PushDeviceDocument
        | undefined;

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

      if (
        previousTokenOwnerSnapshot?.exists &&
        shouldReleasePushTokenOwner(
          previousTokenOwnerSnapshot.data(),
          uid,
          installationDocumentId
        )
      ) {
        tx.delete(previousTokenOwnerSnapshot.ref);
      }

      tx.set(
        deviceRef,
        {
          token,
          platform,
          schemaVersion: 2,
          createdAt: currentForWrite?.createdAt ?? now,
          updatedAt: now,
          lastSeenAt: now,
        },
        { merge: true }
      );

      // O mesmo token FCM só possui um proprietário canônico em toda a
      // plataforma. Um registro posterior transfere a autoridade atomicamente.
      tx.set(tokenOwnerRef, {
        uid,
        deviceId: installationDocumentId,
        schemaVersion: PUSH_TOKEN_OWNER_SCHEMA_VERSION,
        updatedAt: now,
      });
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
      const deviceSnapshot = await tx.get(deviceRef);
      const registeredToken = normalizePushToken(
        deviceSnapshot.data()?.token
      );
      const tokensToRelease = new Set(
        [requestedToken, registeredToken].filter(
          (token): token is string => token !== null
        )
      );
      const tokens = Array.from(tokensToRelease);
      const ownerRefs = tokens.map((token) =>
        db
          .collection(PUSH_TOKEN_OWNERS_COLLECTION)
          .doc(buildPushTokenDocumentId(token))
      );
      const ownerSnapshots = await Promise.all(
        ownerRefs.map((ownerRef) => tx.get(ownerRef))
      );

      tx.delete(deviceRef);

      // Logout/desregistro atrasado nunca pode remover um token que já foi
      // transferido a outro usuário ou a outra instalação.
      for (let index = 0; index < ownerRefs.length; index += 1) {
        const ownerRef = ownerRefs[index];
        const ownerSnapshot = ownerSnapshots[index];

        if (
          ownerRef &&
          ownerSnapshot?.exists &&
          shouldReleasePushTokenOwner(
            ownerSnapshot.data(),
            uid,
            installationDocumentId
          )
        ) {
          tx.delete(ownerRef);
        }
      }
    });

    return { ok: true };
  }
);
