import { onCall } from 'firebase-functions/v2/https';

import {
  ADMIN_BROWSER_CALLABLE_OPTIONS,
} from '../../config/admin-browser-callable-options';
import {
  assertAdminAuthorization,
} from './admin-authorization.policy';
import {
  listVideoModerationQueue as listVideoModerationQueueCore,
  reviewVideoModeration as reviewVideoModerationCore,
} from './admin-video-moderation.handler';
import {
  listVideoProcessingRecoveryJobs as listVideoProcessingRecoveryJobsCore,
  recoverVideoProcessingJob as recoverVideoProcessingJobCore,
} from './admin-video-processing-recovery.handler';
import {
  getVideoProcessingOperationalStatus as getVideoProcessingOperationalStatusCore,
} from './admin-video-processing-status.handler';
import {
  assertMediaCallableRateLimit,
} from './media-callable-rate-limit.service';

interface ListVideoModerationQueueRequest {
  limit?: number;
}

interface ReviewVideoModerationRequest {
  ownerUid?: string;
  videoId?: string;
  decision?: 'APPROVE' | 'REJECT';
  reason?: string | null;
}

interface ListVideoProcessingRecoveryJobsRequest {
  limit?: number;
}

interface RecoverVideoProcessingJobRequest {
  ownerUid?: string;
  videoId?: string;
  action?: 'RETRY_FAILED' | 'RECHECK_STALE' | 'CANCEL_ACTIVE';
  reason?: string;
  operationId?: string;
}

const DEFAULT_MODERATION_QUEUE_LIMIT = 40;
const MAX_MODERATION_QUEUE_LIMIT = 80;
const DEFAULT_RECOVERY_QUEUE_LIMIT = 30;
const MAX_RECOVERY_QUEUE_LIMIT = 60;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  maximum: number
): number {
  const numeric = Number(value ?? fallback);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(maximum, Math.trunc(numeric)));
}

function mediaResourceKey(
  prefix: string,
  ownerUid: unknown,
  mediaId: unknown
): string {
  return `${prefix}:${cleanId(ownerUid) || 'invalid-owner'}:` +
    `${cleanId(mediaId) || 'invalid-media'}`;
}

async function applyAdminRateLimit(input: {
  actorUid: string;
  action:
    | 'ADMIN_STATUS'
    | 'ADMIN_QUEUE'
    | 'ADMIN_MODERATION'
    | 'ADMIN_PROCESSING_RECOVERY';
  resourceKey: string;
  cost?: number;
}): Promise<void> {
  await assertMediaCallableRateLimit(input);
}

export const getVideoProcessingOperationalStatus = onCall<
  Record<string, never>
>(
  ADMIN_BROWSER_CALLABLE_OPTIONS,
  async (request) => {
    const adminUid = assertAdminAuthorization(
      request.auth,
      'Apenas administradores podem consultar o processamento de vídeos.'
    );

    await applyAdminRateLimit({
      actorUid: adminUid,
      action: 'ADMIN_STATUS',
      resourceKey: 'video-processing-operational-status',
    });

    return getVideoProcessingOperationalStatusCore.run(request);
  }
);

export const listVideoModerationQueue = onCall<
  ListVideoModerationQueueRequest
>(
  ADMIN_BROWSER_CALLABLE_OPTIONS,
  async (request) => {
    const adminUid = assertAdminAuthorization(
      request.auth,
      'Apenas administradores podem moderar vídeos.'
    );
    const limit = normalizeLimit(
      request.data?.limit,
      DEFAULT_MODERATION_QUEUE_LIMIT,
      MAX_MODERATION_QUEUE_LIMIT
    );

    await applyAdminRateLimit({
      actorUid: adminUid,
      action: 'ADMIN_QUEUE',
      resourceKey: 'video-moderation-queue',
      cost: limit,
    });

    return listVideoModerationQueueCore.run(request);
  }
);

export const reviewVideoModeration = onCall<ReviewVideoModerationRequest>(
  ADMIN_BROWSER_CALLABLE_OPTIONS,
  async (request) => {
    const adminUid = assertAdminAuthorization(
      request.auth,
      'Apenas administradores podem moderar vídeos.'
    );

    await applyAdminRateLimit({
      actorUid: adminUid,
      action: 'ADMIN_MODERATION',
      resourceKey: mediaResourceKey(
        'video-moderation',
        request.data?.ownerUid,
        request.data?.videoId
      ),
      cost: 2,
    });

    return reviewVideoModerationCore.run(request);
  }
);

export const listVideoProcessingRecoveryJobs = onCall<
  ListVideoProcessingRecoveryJobsRequest
>(
  ADMIN_BROWSER_CALLABLE_OPTIONS,
  async (request) => {
    const adminUid = assertAdminAuthorization(
      request.auth,
      'Apenas administradores podem recuperar o processamento de vídeos.'
    );
    const limit = normalizeLimit(
      request.data?.limit,
      DEFAULT_RECOVERY_QUEUE_LIMIT,
      MAX_RECOVERY_QUEUE_LIMIT
    );

    await applyAdminRateLimit({
      actorUid: adminUid,
      action: 'ADMIN_QUEUE',
      resourceKey: 'video-processing-recovery-queue',
      cost: limit,
    });

    return listVideoProcessingRecoveryJobsCore.run(request);
  }
);

export const recoverVideoProcessingJob = onCall<
  RecoverVideoProcessingJobRequest
>(
  ADMIN_BROWSER_CALLABLE_OPTIONS,
  async (request) => {
    const adminUid = assertAdminAuthorization(
      request.auth,
      'Apenas administradores podem recuperar o processamento de vídeos.'
    );

    await applyAdminRateLimit({
      actorUid: adminUid,
      action: 'ADMIN_PROCESSING_RECOVERY',
      resourceKey: mediaResourceKey(
        'video-processing-recovery',
        request.data?.ownerUid,
        request.data?.videoId
      ),
      cost: 3,
    });

    return recoverVideoProcessingJobCore.run(request);
  }
);
