import { HttpsError } from 'firebase-functions/v2/https';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

export type PrivatePhotoStorageConsistencyState =
  | 'consistent'
  | 'missing_private_document'
  | 'invalid_private_path'
  | 'missing_storage_object';

export interface PrivatePhotoStorageConsistencyInspection {
  ownerUid: string;
  photoId: string;
  storagePath: string | null;
  state: PrivatePhotoStorageConsistencyState;
}

export interface ReconcilePrivatePhotoStorageResult
  extends PrivatePhotoStorageConsistencyInspection {
  reconciled: boolean;
  cleanupPending: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    Array.from(normalized).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 31 || code === 127);
    })
  ) {
    return '';
  }

  return normalized;
}

/**
 * Inspeção canônica da consistência entre o agregado privado da foto no
 * Firestore e o objeto privado correspondente no Storage.
 *
 * A inspeção nunca altera estado. Erros de transporte/Storage são propagados;
 * somente a inexistência confirmada do objeto é classificada como órfã.
 */
export async function inspectPrivatePhotoStorageConsistency(
  ownerUidValue: unknown,
  photoIdValue: unknown
): Promise<PrivatePhotoStorageConsistencyInspection> {
  const ownerUid = cleanId(ownerUidValue);
  const photoId = cleanId(photoIdValue);

  if (!ownerUid || !photoId) {
    throw new HttpsError(
      'invalid-argument',
      'Foto ou proprietário inválidos para inspeção de consistência.'
    );
  }

  const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
  const privatePhotoSnap = await privatePhotoRef.get();

  if (!privatePhotoSnap.exists) {
    return {
      ownerUid,
      photoId,
      storagePath: null,
      state: 'missing_private_document',
    };
  }

  const privatePhoto = privatePhotoSnap.data() as {
    path?: unknown;
    url?: unknown;
  };
  const storagePath =
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.url);

  if (!storagePath) {
    return {
      ownerUid,
      photoId,
      storagePath: null,
      state: 'invalid_private_path',
    };
  }

  const [exists] = await getDefaultStorageBucket()
    .file(storagePath)
    .exists();

  return {
    ownerUid,
    photoId,
    storagePath,
    state: exists ? 'consistent' : 'missing_storage_object',
  };
}

/**
 * Reconcilia somente órfãos confirmados.
 *
 * A mutação reutiliza deleteProfilePhotoResources(), que já é a autoridade
 * canônica de exclusão de foto: remove projeções públicas, respeita bloqueios
 * de moderação, preserva evidência e usa o fluxo de cleanup existente.
 *
 * Estados inválidos não são apagados automaticamente.
 */
export async function reconcilePrivatePhotoStorageConsistency(
  ownerUidValue: unknown,
  photoIdValue: unknown
): Promise<ReconcilePrivatePhotoStorageResult> {
  const inspection = await inspectPrivatePhotoStorageConsistency(
    ownerUidValue,
    photoIdValue
  );

  if (inspection.state !== 'missing_storage_object') {
    return {
      ...inspection,
      reconciled: false,
      cleanupPending: false,
    };
  }

  // Revalida imediatamente antes da mutação para reduzir TOCTOU.
  const confirmation = await inspectPrivatePhotoStorageConsistency(
    inspection.ownerUid,
    inspection.photoId
  );

  if (confirmation.state !== 'missing_storage_object') {
    return {
      ...confirmation,
      reconciled: false,
      cleanupPending: false,
    };
  }

  const deletion = await deleteProfilePhotoResources(
    confirmation.ownerUid,
    confirmation.photoId
  );

  return {
    ...confirmation,
    reconciled: true,
    cleanupPending: deletion.cleanupPending,
  };
}
