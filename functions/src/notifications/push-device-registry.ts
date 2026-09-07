import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildPushTokenDocumentId,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushToken,
  resolvePushDevicePlatform,
} from './push-device.policy';

interface PushDeviceRequest {
  token?: unknown;
  platform?: unknown;
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

function requirePlatform(value: unknown) {
  const platform = resolvePushDevicePlatform(value);

  if (!platform) {
    throw new HttpsError('invalid-argument', 'Plataforma do dispositivo inválida.');
  }

  return platform;
}

export const registerPushDevice = onCall<PushDeviceRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ ok: true }> => {
    const uid = requireUid(request.auth?.uid);
    const token = requireToken(request.data?.token);
    const platform = requirePlatform(request.data?.platform);
    const tokenId = buildPushTokenDocumentId(token);
    const userRef = db.collection('users').doc(uid);
    const devicesRef = userRef.collection('push_devices');
    const deviceRef = devicesRef.doc(tokenId);

    await db.runTransaction(async (tx) => {
      const userSnapshot = await tx.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
      }

      const devicesSnapshot = await tx.get(
        devicesRef
          .orderBy('lastSeenAt', 'asc')
          .limit(MAX_PUSH_DEVICES_PER_USER)
      );
      const existingDevice = devicesSnapshot.docs.find(
        (snapshot) => snapshot.id === tokenId
      );
      const now = FieldValue.serverTimestamp();

      if (existingDevice) {
        const current = existingDevice.data() as PushDeviceDocument;
        tx.set(
          deviceRef,
          {
            token,
            platform,
            schemaVersion: 1,
            createdAt: current.createdAt ?? now,
            updatedAt: now,
            lastSeenAt: now,
          },
          { merge: true }
        );
        return;
      }

      if (devicesSnapshot.size >= MAX_PUSH_DEVICES_PER_USER) {
        const oldestDevice = devicesSnapshot.docs[0];
        if (oldestDevice) {
          tx.delete(oldestDevice.ref);
        }
      }

      tx.create(deviceRef, {
        token,
        platform,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      });
    });

    return { ok: true };
  }
);

export const unregisterPushDevice = onCall<PushDeviceRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ ok: true }> => {
    const uid = requireUid(request.auth?.uid);
    const token = requireToken(request.data?.token);
    const tokenId = buildPushTokenDocumentId(token);

    await db
      .collection('users')
      .doc(uid)
      .collection('push_devices')
      .doc(tokenId)
      .delete();

    return { ok: true };
  }
);
