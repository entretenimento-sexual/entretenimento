import { createHash, randomUUID } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  normalizePrivateMediaDraftUsage,
} from './private-media-draft.policy';
import {
  reconcilePrivateMediaDraftUsage,
  type PrivateMediaDraftSnapshotInput,
  type PrivateMediaUploadReservationSnapshotInput,
} from './private-media-draft-reconciliation.policy';
import { privateMediaDraftHttpsError } from './private-media-draft-error';

interface ReconcilePrivateMediaDraftUsageRequest {
  ownerUid?: unknown;
  apply?: unknown;
  operationId?: unknown;
}

interface ReconcilePrivateMediaDraftUsageResponse {
  applied: boolean;
  consistent: boolean;
  current: ReturnType<typeof normalizePrivateMediaDraftUsage>;
  expected: ReturnType<typeof normalizePrivateMediaDraftUsage>;
  delta: ReturnType<typeof normalizePrivateMediaDraftUsage>;
  examined: {
    photos: number;
    videos: number;
    reservations: number;
  };
  activeDrafts: {
    photos: number;
    videos: number;
  };
  activeUploadReservations: number;
  generatedAt: number;
}

const USAGE_COLLECTION = 'media_private_draft_usage';
const RESERVATIONS_COLLECTION = 'media_private_upload_reservations';
const AUDIT_COLLECTION = 'media_private_draft_reconciliation_audit';
const MAX_SOURCE_DOCUMENTS = 200;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function cleanOperationId(value: unknown): string {
  const normalized = cleanId(value);
  return normalized || randomUUID();
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value ?? 0);

  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }

  const candidate = value as { toMillis?: () => number } | null | undefined;
  return typeof candidate?.toMillis === 'function'
    ? Math.trunc(candidate.toMillis())
    : 0;
}

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function auditDocumentId(requesterUid: string, operationId: string): string {
  return createHash('sha256')
    .update(`${requesterUid}:${operationId}`)
    .digest('hex');
}

async function assertAdministrator(
  requesterUid: string,
  tokenAdmin: boolean
): Promise<void> {
  if (tokenAdmin) {
    return;
  }

  const snapshot = await db.doc(`users/${requesterUid}`).get();
  const role = String(snapshot.data()?.['role'] ?? '').trim().toLowerCase();

  if (role !== 'admin') {
    throw privateMediaDraftHttpsError(
      'permission-denied',
      'MEDIA_DRAFT_RECONCILIATION_FORBIDDEN',
      'A reconciliação de quota é restrita à administração.',
      'Use uma conta administrativa autorizada.'
    );
  }
}

function ensureBoundedSource(
  label: string,
  size: number
): void {
  if (size > MAX_SOURCE_DOCUMENTS) {
    throw privateMediaDraftHttpsError(
      'failed-precondition',
      'MEDIA_DRAFT_RECONCILIATION_CONFLICT',
      `A fonte ${label} excede o limite seguro da reconciliação por usuário.`,
      'Revise o perfil e execute uma migração administrativa paginada.'
    );
  }
}

export const reconcilePrivateMediaDraftUsageAdmin = onCall<
  ReconcilePrivateMediaDraftUsageRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReconcilePrivateMediaDraftUsageResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const apply = request.data?.apply === true;
    const operationId = cleanOperationId(request.data?.operationId);

    if (!requesterUid) {
      throw privateMediaDraftHttpsError(
        'unauthenticated',
        'MEDIA_DRAFT_RECONCILIATION_FORBIDDEN',
        'Usuário não autenticado.',
        'Entre novamente com uma conta administrativa.'
      );
    }

    if (!ownerUid) {
      throw privateMediaDraftHttpsError(
        'invalid-argument',
        'MEDIA_DRAFT_RECONCILIATION_CONFLICT',
        'O perfil de destino é inválido.',
        'Informe um identificador de perfil válido.'
      );
    }

    if (apply && !cleanId(request.data?.operationId)) {
      throw privateMediaDraftHttpsError(
        'invalid-argument',
        'MEDIA_DRAFT_RECONCILIATION_CONFLICT',
        'A correção exige um identificador de operação.',
        'Gere um operationId único e repita a solicitação.'
      );
    }

    await assertAdministrator(
      requesterUid,
      request.auth?.token?.['admin'] === true
    );

    const usageRef = db.collection(USAGE_COLLECTION).doc(ownerUid);
    const [
      usageSnapshot,
      photosSnapshot,
      videosSnapshot,
      reservationsSnapshot,
    ] = await Promise.all([
      usageRef.get(),
      db.collection(`users/${ownerUid}/photos`)
        .limit(MAX_SOURCE_DOCUMENTS + 1)
        .get(),
      db.collection(`users/${ownerUid}/videos`)
        .limit(MAX_SOURCE_DOCUMENTS + 1)
        .get(),
      db.collection(RESERVATIONS_COLLECTION)
        .where('ownerUid', '==', ownerUid)
        .limit(MAX_SOURCE_DOCUMENTS + 1)
        .get(),
    ]);

    ensureBoundedSource('photos', photosSnapshot.size);
    ensureBoundedSource('videos', videosSnapshot.size);
    ensureBoundedSource('reservas', reservationsSnapshot.size);

    const drafts: PrivateMediaDraftSnapshotInput[] = [
      ...photosSnapshot.docs.map((document) => ({
        kind: 'photo' as const,
        ...document.data(),
      })),
      ...videosSnapshot.docs.map((document) => ({
        kind: 'video' as const,
        ...document.data(),
      })),
    ];
    const reservations: PrivateMediaUploadReservationSnapshotInput[] =
      reservationsSnapshot.docs.map((document) => document.data());
    const result = reconcilePrivateMediaDraftUsage(
      usageSnapshot.exists ? usageSnapshot.data() : null,
      drafts,
      reservations
    );
    const generatedAt = Date.now();
    const initialUpdatedAt = normalizeTimestamp(
      usageSnapshot.data()?.['updatedAt']
    );
    const auditRef = db
      .collection(AUDIT_COLLECTION)
      .doc(auditDocumentId(requesterUid, operationId));
    let applied = false;

    if (apply && !result.consistent) {
      await db.runTransaction(async (transaction) => {
        const [currentUsageSnapshot, existingAuditSnapshot] = await Promise.all([
          transaction.get(usageRef),
          transaction.get(auditRef),
        ]);

        if (existingAuditSnapshot.exists) {
          applied = existingAuditSnapshot.data()?.['applied'] === true;
          return;
        }

        const currentUpdatedAt = normalizeTimestamp(
          currentUsageSnapshot.data()?.['updatedAt']
        );

        if (currentUpdatedAt !== initialUpdatedAt) {
          throw privateMediaDraftHttpsError(
            'aborted',
            'MEDIA_DRAFT_RECONCILIATION_CONFLICT',
            'A quota mudou durante a reconciliação.',
            'Execute novamente o modo de diagnóstico antes de aplicar.',
            true
          );
        }

        transaction.set(
          usageRef,
          {
            ...result.expected,
            version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
            updatedAt: generatedAt,
            reconciledAt: generatedAt,
            reconciliationVersion: 1,
          },
          { merge: true }
        );
        transaction.create(auditRef, {
          requesterHash: hashIdentity(requesterUid),
          ownerHash: hashIdentity(ownerUid),
          operationId,
          apply: true,
          applied: true,
          consistentBefore: false,
          current: result.current,
          expected: result.expected,
          delta: result.delta,
          examined: {
            photos: photosSnapshot.size,
            videos: videosSnapshot.size,
            reservations: reservationsSnapshot.size,
          },
          generatedAt,
        });
        applied = true;
      });
    } else {
      await auditRef.set({
        requesterHash: hashIdentity(requesterUid),
        ownerHash: hashIdentity(ownerUid),
        operationId,
        apply,
        applied: false,
        consistentBefore: result.consistent,
        current: result.current,
        expected: result.expected,
        delta: result.delta,
        examined: {
          photos: photosSnapshot.size,
          videos: videosSnapshot.size,
          reservations: reservationsSnapshot.size,
        },
        generatedAt,
      }, { merge: false });
    }

    logger.info('[privateMediaDraftReconciliation] Execução concluída.', {
      requesterHash: hashIdentity(requesterUid),
      ownerHash: hashIdentity(ownerUid),
      apply,
      applied,
      consistent: result.consistent,
      examinedPhotos: photosSnapshot.size,
      examinedVideos: videosSnapshot.size,
      examinedReservations: reservationsSnapshot.size,
    });

    return {
      applied,
      consistent: result.consistent,
      current: result.current,
      expected: result.expected,
      delta: result.delta,
      examined: {
        photos: photosSnapshot.size,
        videos: videosSnapshot.size,
        reservations: reservationsSnapshot.size,
      },
      activeDrafts: result.activeDrafts,
      activeUploadReservations: result.activeUploadReservations,
      generatedAt,
    };
  }
);
