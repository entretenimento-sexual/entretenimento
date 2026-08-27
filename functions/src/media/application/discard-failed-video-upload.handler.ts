import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { deleteProfileVideoResources } from './delete-profile-video.handler';

interface FailedVideoDocument {
  ownerUid?: unknown;
  status?: unknown;
  processingErrorCode?: unknown;
  processingErrorMessage?: unknown;
}

const FAILED_CLEANUP_BATCH_SIZE = 50;
const FAILED_VIDEO_NOTIFICATION_TYPE = 'video.processing_failed';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function isFailed(value: FailedVideoDocument | null | undefined): boolean {
  return String(value?.status ?? '').trim().toLowerCase() === 'failed';
}

function removeControlCharacters(value: unknown): string {
  const raw = String(value ?? '');
  let sanitized = '';

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    sanitized += code <= 31 || code === 127 ? ' ' : raw[index];
  }

  return sanitized;
}

function safeFailureReason(value: unknown): string {
  const normalized = removeControlCharacters(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  return normalized || 'Não foi possível preparar o arquivo para publicação.';
}

function failureNotificationId(ownerUid: string, videoId: string): string {
  return createHash('sha256')
    .update(`${FAILED_VIDEO_NOTIFICATION_TYPE}:${ownerUid}:${videoId}`)
    .digest('hex');
}

async function ensureFailureNotification(
  ownerUid: string,
  videoId: string,
  reason: string
): Promise<void> {
  const notificationRef = db
    .collection('notifications')
    .doc(failureNotificationId(ownerUid, videoId));

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(notificationRef);

    if (existing.exists) {
      return;
    }

    const now = FieldValue.serverTimestamp();
    transaction.create(notificationRef, {
      userId: ownerUid,
      type: FAILED_VIDEO_NOTIFICATION_TYPE,
      title: 'Vídeo descartado',
      body: `${reason} O upload foi removido da plataforma; envie outro arquivo para tentar novamente.`,
      route: '/media/videos',
      readAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function discardFailedVideo(
  ownerUidValue: unknown,
  videoIdValue: unknown,
  video: FailedVideoDocument | null | undefined
): Promise<void> {
  const ownerUid = cleanId(ownerUidValue);
  const videoId = cleanId(videoIdValue);

  if (!ownerUid || !videoId || !isFailed(video)) {
    return;
  }

  const persistedOwnerUid = cleanId(video?.ownerUid ?? ownerUid);

  if (persistedOwnerUid !== ownerUid) {
    logger.error('[discardFailedVideoUpload] Proprietário divergente.', {
      ownerUid,
      videoId,
    });
    return;
  }

  const reason = safeFailureReason(video?.processingErrorMessage);

  // O feedback é persistido antes da exclusão para o motivo não desaparecer
  // junto com o documento do upload que falhou.
  await ensureFailureNotification(ownerUid, videoId, reason);

  const result = await deleteProfileVideoResources(ownerUid, videoId);

  logger.info('[discardFailedVideoUpload] Upload com falha descartado.', {
    ownerUid,
    videoId,
    processingErrorCode: String(video?.processingErrorCode ?? '')
      .trim()
      .slice(0, 120),
    cleanupPending: result.cleanupPending,
  });
}

/**
 * Qualquer caminho de processamento que materialize status=failed converge
 * aqui. O produto não mantém um vídeo falho/privado esperando ação manual.
 */
export const discardFailedVideoUpload = onDocumentUpdated(
  {
    document: 'users/{ownerUid}/videos/{videoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data() as FailedVideoDocument | undefined;
    const after = event.data?.after.data() as FailedVideoDocument | undefined;

    if (!isFailed(after) || isFailed(before)) {
      return;
    }

    await discardFailedVideo(
      event.params.ownerUid,
      event.params.videoId,
      after
    );
  }
);

/**
 * Recupera uploads falhos antigos e também cobre uma eventual interrupção do
 * trigger. Só aceita documentos no caminho canônico users/{uid}/videos/{id}.
 */
export const cleanupFailedVideoUploads = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const snapshot = await db
      .collectionGroup('videos')
      .where('status', '==', 'failed')
      .limit(FAILED_CLEANUP_BATCH_SIZE)
      .get();

    for (const document of snapshot.docs) {
      const segments = document.ref.path.split('/');

      if (
        segments.length !== 4 ||
        segments[0] !== 'users' ||
        segments[2] !== 'videos'
      ) {
        continue;
      }

      try {
        await discardFailedVideo(
          segments[1],
          segments[3],
          document.data() as FailedVideoDocument
        );
      } catch (error) {
        logger.error('[cleanupFailedVideoUploads] Falha no descarte.', {
          ownerUid: segments[1],
          videoId: segments[3],
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : String(error ?? '').slice(0, 500),
        });
      }
    }
  }
);