import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import { storage } from '../../firebaseApp';
import {
  deleteProfilePhoto as deleteProfilePhotoCore,
} from './delete-profile-photo.handler';
import {
  deleteProfileVideo as deleteProfileVideoCore,
} from './delete-profile-video.handler';
import {
  setCoverPhoto as setCoverPhotoCore,
} from './manage-photo-publication.handler';
import {
  assertMediaCallableRateLimit,
} from './media-callable-rate-limit.service';
import {
  executeMediaMutationIdempotently,
  type MediaMutationAction,
} from './media-mutation-idempotency.service';
import {
  resolveUploadMutationCost,
} from './media-mutation-idempotency.policy';
import {
  extractOwnedPrivatePhotoPathForId,
} from './photo-storage-path';
import {
  publishPhoto as publishPhotoCore,
} from './publish-photo-orchestrator.handler';
import {
  publishVideo as publishVideoCore,
} from './publish-video-orchestrator.handler';
import {
  registerAndPublishPhotoUpload as registerAndPublishPhotoUploadCore,
} from './register-and-publish-photo-upload.handler';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload-orchestrator.handler';
import {
  updateVideoPublicationSettings as updateVideoPublicationSettingsCore,
} from './update-video-publication-settings.handler';
import {
  extractOwnedPrivateVideoPathForId,
} from './video-storage-path';
import type {
  MediaCallableRateAction,
} from './media-callable-rate-limit.policy';

interface PublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
  visibility?: 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
  caption?: string | null;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  commentsPolicy?: 'OFF' | 'FRIENDS' | 'SUBSCRIBERS' | 'EVERYONE';
  reactionsEnabled?: boolean;
}

interface RegisterAndPublishPhotoUploadRequest extends PublishPhotoRequest {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  [key: string]: unknown;
}

interface PhotoTargetRequest {
  ownerUid?: string;
  photoId?: string;
}

interface PublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
  visibility?: 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
  orderIndex?: number;
}

interface VideoTargetRequest {
  ownerUid?: string;
  videoId?: string;
}

interface UpdateVideoPublicationSettingsRequest extends VideoTargetRequest {
  title?: unknown;
  description?: unknown;
  reactionsEnabled?: unknown;
  commentsEnabled?: unknown;
  ratingsEnabled?: unknown;
}

interface RegisterPrivateVideoUploadRequest extends UpdateVideoPublicationSettingsRequest {
  videoStoragePath?: string;
  posterStoragePath?: string | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  publishWhenReady?: boolean;
  [key: string]: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function resourceKey(
  mediaType: 'photo' | 'video',
  ownerUid: unknown,
  mediaId: unknown
): string {
  return [
    mediaType,
    cleanId(ownerUid) || 'invalid-owner',
    cleanId(mediaId) || 'invalid-media',
  ].join(':');
}

async function executeProtectedMutation<T>(input: {
  actorUid: string;
  idempotencyAction: MediaMutationAction;
  rateAction: MediaCallableRateAction;
  resourceKey: string;
  requestData: unknown;
  cost: number;
  execute: () => Promise<T>;
}): Promise<T> {
  if (!input.actorUid) {
    return input.execute();
  }

  return executeMediaMutationIdempotently({
    actorUid: input.actorUid,
    action: input.idempotencyAction,
    resourceKey: input.resourceKey,
    requestData: input.requestData,
    execute: async () => {
      await assertMediaCallableRateLimit({
        actorUid: input.actorUid,
        action: input.rateAction,
        resourceKey: input.resourceKey,
        cost: input.cost,
      });

      return input.execute();
    },
  });
}

async function resolveVideoUploadCost(
  actorUid: string,
  data: RegisterPrivateVideoUploadRequest | undefined
): Promise<number> {
  const ownerUid = cleanId(data?.ownerUid);
  const videoId = cleanId(data?.videoId);

  if (!actorUid || actorUid !== ownerUid || !videoId) {
    return resolveUploadMutationCost(null);
  }

  const storagePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    data?.videoStoragePath
  );

  if (!storagePath) {
    return resolveUploadMutationCost(null);
  }

  try {
    const [metadata] = await storage.bucket().file(storagePath).getMetadata();
    return resolveUploadMutationCost(metadata.size);
  } catch {
    return resolveUploadMutationCost(null);
  }
}

async function resolvePhotoUploadCost(
  actorUid: string,
  data: RegisterAndPublishPhotoUploadRequest | undefined
): Promise<number> {
  const ownerUid = cleanId(data?.ownerUid);
  const photoId = cleanId(data?.photoId);

  if (!actorUid || actorUid !== ownerUid || !photoId) {
    return resolveUploadMutationCost(null);
  }

  const storagePath = extractOwnedPrivatePhotoPathForId(
    ownerUid,
    photoId,
    data?.storagePath
  );

  if (!storagePath) {
    return resolveUploadMutationCost(null);
  }

  try {
    const [metadata] = await storage.bucket().file(storagePath).getMetadata();
    return resolveUploadMutationCost(metadata.size);
  } catch {
    return resolveUploadMutationCost(null);
  }
}

export const registerPrivateVideoUpload = onCall<RegisterPrivateVideoUploadRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);
    const key = resourceKey(
      'video',
      request.data?.ownerUid,
      request.data?.videoId
    );

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'UPLOAD_REGISTER',
        resourceKey: key,
        cost: await resolveVideoUploadCost(actorUid, request.data),
      });
    }

    return registerPrivateVideoUploadCore.run(request);
  }
);

export const registerAndPublishPhotoUpload = onCall<
  RegisterAndPublishPhotoUploadRequest
>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);
    const key = resourceKey(
      'photo',
      request.data?.ownerUid,
      request.data?.photoId
    );

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'UPLOAD_REGISTER',
        resourceKey: key,
        cost: await resolvePhotoUploadCost(actorUid, request.data),
      });
    }

    return registerAndPublishPhotoUploadCore.run(request);
  }
);

export const publishPhoto = onCall<PublishPhotoRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'PHOTO_PUBLISH',
    rateAction: 'MEDIA_PUBLISH',
    resourceKey: resourceKey(
      'photo',
      request.data?.ownerUid,
      request.data?.photoId
    ),
    requestData: request.data,
    cost: 2,
    execute: () => publishPhotoCore.run(request),
  })
);

/**
 * Mantemos o nome público para clientes antigos receberem uma resposta segura,
 * mas a operação foi encerrada: publicação não pode voltar a ser armazenamento
 * pessoal. Para remover conteúdo, o usuário deve usar deleteProfilePhoto.
 */
export const unpublishPhoto = onCall<PhotoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async () => {
    throw new HttpsError(
      'failed-precondition',
      'Fotos publicadas não podem ser convertidas em arquivos privados. Exclua a foto para removê-la da plataforma.'
    );
  }
);

export const setCoverPhoto = onCall<PhotoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'PHOTO_SET_COVER',
    rateAction: 'MEDIA_COVER',
    resourceKey: resourceKey(
      'photo',
      request.data?.ownerUid,
      request.data?.photoId
    ),
    requestData: request.data,
    cost: 1,
    execute: () => setCoverPhotoCore.run(request),
  })
);

export const publishVideo = onCall<PublishVideoRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'VIDEO_PUBLISH',
    rateAction: 'MEDIA_PUBLISH',
    resourceKey: resourceKey(
      'video',
      request.data?.ownerUid,
      request.data?.videoId
    ),
    requestData: request.data,
    cost: 5,
    execute: () => publishVideoCore.run(request),
  })
);

/**
 * Mesma política das fotos: remover do perfil sem excluir reabriria a biblioteca
 * privada. O nome permanece para compatibilidade e devolve orientação explícita.
 */
export const unpublishVideo = onCall<VideoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async () => {
    throw new HttpsError(
      'failed-precondition',
      'Vídeos publicados não podem ser convertidos em arquivos privados. Exclua o vídeo para removê-lo da plataforma.'
    );
  }
);

export const deleteProfilePhoto = onCall<PhotoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'PHOTO_DELETE',
    rateAction: 'MEDIA_DELETE',
    resourceKey: resourceKey(
      'photo',
      request.data?.ownerUid,
      request.data?.photoId
    ),
    requestData: request.data,
    cost: 2,
    execute: () => deleteProfilePhotoCore.run(request),
  })
);

export const deleteProfileVideo = onCall<VideoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'VIDEO_DELETE',
    rateAction: 'MEDIA_DELETE',
    resourceKey: resourceKey(
      'video',
      request.data?.ownerUid,
      request.data?.videoId
    ),
    requestData: request.data,
    cost: 5,
    execute: () => deleteProfileVideoCore.run(request),
  })
);

export const updateVideoPublicationSettings = onCall<
  UpdateVideoPublicationSettingsRequest
>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => executeProtectedMutation({
    actorUid: cleanId(request.auth?.uid),
    idempotencyAction: 'VIDEO_SETTINGS',
    rateAction: 'MEDIA_SETTINGS',
    resourceKey: resourceKey(
      'video',
      request.data?.ownerUid,
      request.data?.videoId
    ),
    requestData: request.data,
    cost: 1,
    execute: () => updateVideoPublicationSettingsCore.run(request),
  })
);