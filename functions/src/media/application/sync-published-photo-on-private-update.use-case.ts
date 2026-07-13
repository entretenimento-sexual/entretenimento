import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

export type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';

export interface PrivatePhotoDoc {
  path?: string;
  url?: string;
  fileName?: string;
  alt?: string;
}

export interface PhotoPublicationDoc {
  isPublished?: boolean;
  sourceStoragePath?: string;
  publishedStoragePath?: string;
}

export interface PublishedPhotoSyncInput {
  ownerUid: string;
  photoId: string;
  before: PrivatePhotoDoc;
  after: PrivatePhotoDoc;
}

export interface PhotoSyncCommit {
  ownerUid: string;
  photoId: string;
  publicationPatch: Record<string, unknown>;
  publicPhotoPatch: Record<string, unknown>;
}

export interface PhotoSyncDependencies {
  moderationStatus: ModerationStatus;
  now: () => number;
  loadPublication: (
    ownerUid: string,
    photoId: string
  ) => Promise<PhotoPublicationDoc | null>;
  copyPublishedAsset: (command: {
    ownerUid: string;
    photoId: string;
    sourceStoragePath: string;
  }) => Promise<string>;
  commitPatches: (commit: PhotoSyncCommit) => Promise<void>;
  deletePublishedAsset: (command: {
    ownerUid: string;
    photoId: string;
    storagePath: string;
    reason: string;
  }) => Promise<unknown>;
  refreshMetrics: (ownerUid: string) => Promise<void>;
  logError: (message: string, context: Record<string, unknown>) => void;
}

export type PublishedPhotoSyncResult =
  | {
      status: 'ignored-no-change' | 'ignored-not-published' | 'ignored-invalid-source';
    }
  | {
      status: 'already-synchronized';
      binaryChanged: true;
      metadataChanged: false;
      copiedAsset: false;
      moderationStatus: ModerationStatus;
    }
  | {
      status: 'synchronized';
      binaryChanged: boolean;
      metadataChanged: boolean;
      copiedAsset: boolean;
      moderationStatus: ModerationStatus;
    };

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveSourceStoragePath(
  ownerUid: string,
  photo: PrivatePhotoDoc
): string | null {
  return (
    extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, photo.url)
  );
}

function hasBinaryChanged(
  ownerUid: string,
  before: PrivatePhotoDoc,
  after: PrivatePhotoDoc
): boolean {
  return (
    resolveSourceStoragePath(ownerUid, before) !==
    resolveSourceStoragePath(ownerUid, after)
  );
}

function hasPublicMetadataChanged(
  before: PrivatePhotoDoc,
  after: PrivatePhotoDoc
): boolean {
  return (
    cleanText(before.alt) !== cleanText(after.alt) ||
    cleanText(before.fileName) !== cleanText(after.fileName)
  );
}

function resolvePublicAlt(photo: PrivatePhotoDoc): string {
  return cleanText(photo.alt) || cleanText(photo.fileName) || 'Foto do perfil';
}

export async function synchronizePublishedPhotoUpdate(
  input: PublishedPhotoSyncInput,
  dependencies: PhotoSyncDependencies
): Promise<PublishedPhotoSyncResult> {
  const binaryChanged = hasBinaryChanged(
    input.ownerUid,
    input.before,
    input.after
  );
  const metadataChanged = hasPublicMetadataChanged(input.before, input.after);

  if (!binaryChanged && !metadataChanged) {
    return { status: 'ignored-no-change' };
  }

  const publication = await dependencies.loadPublication(
    input.ownerUid,
    input.photoId
  );

  if (!publication || publication.isPublished !== true) {
    return { status: 'ignored-not-published' };
  }

  const sourceStoragePath = resolveSourceStoragePath(
    input.ownerUid,
    input.after
  );

  if (!sourceStoragePath) {
    dependencies.logError(
      '[syncPublishedPhotoOnPrivateUpdate] Foto privada sem caminho válido.',
      {
        ownerUid: input.ownerUid,
        photoId: input.photoId,
      }
    );

    return { status: 'ignored-invalid-source' };
  }

  const previousPublishedStoragePath = cleanText(
    publication.publishedStoragePath
  );
  const sourceAlreadySynchronized =
    cleanText(publication.sourceStoragePath) === sourceStoragePath &&
    !!previousPublishedStoragePath;

  if (binaryChanged && sourceAlreadySynchronized && !metadataChanged) {
    return {
      status: 'already-synchronized',
      binaryChanged: true,
      metadataChanged: false,
      copiedAsset: false,
      moderationStatus: dependencies.moderationStatus,
    };
  }

  const shouldCopyAsset = binaryChanged && !sourceAlreadySynchronized;
  let nextPublishedStoragePath = previousPublishedStoragePath;

  if (shouldCopyAsset) {
    nextPublishedStoragePath = await dependencies.copyPublishedAsset({
      ownerUid: input.ownerUid,
      photoId: input.photoId,
      sourceStoragePath,
    });
  }

  const now = dependencies.now();
  const publicationPatch: Record<string, unknown> = {
    updatedAt: now,
  };
  const publicPhotoPatch: Record<string, unknown> = {
    alt: resolvePublicAlt(input.after),
    updatedAt: now,
  };

  if (shouldCopyAsset) {
    publicationPatch['sourceStoragePath'] = sourceStoragePath;
    publicationPatch['publishedStoragePath'] = nextPublishedStoragePath;
    publicationPatch['assetVersion'] = now;
    publicationPatch['moderationStatus'] = dependencies.moderationStatus;
    publicationPatch['moderationReason'] = null;
    publicationPatch['lastModeratedAt'] =
      dependencies.moderationStatus === 'APPROVED' ? now : null;

    publicPhotoPatch['moderationStatus'] = dependencies.moderationStatus;
    publicPhotoPatch['moderationReason'] = null;
  }

  try {
    await dependencies.commitPatches({
      ownerUid: input.ownerUid,
      photoId: input.photoId,
      publicationPatch,
      publicPhotoPatch,
    });
  } catch (error) {
    if (shouldCopyAsset && nextPublishedStoragePath) {
      await dependencies.deletePublishedAsset({
        ownerUid: input.ownerUid,
        photoId: input.photoId,
        storagePath: nextPublishedStoragePath,
        reason: 'sync-published-photo-firestore-rollback',
      });
    }

    throw error;
  }

  if (
    shouldCopyAsset &&
    previousPublishedStoragePath &&
    previousPublishedStoragePath !== nextPublishedStoragePath
  ) {
    await dependencies.deletePublishedAsset({
      ownerUid: input.ownerUid,
      photoId: input.photoId,
      storagePath: previousPublishedStoragePath,
      reason: 'sync-published-photo-replace-version',
    });
  }

  await dependencies.refreshMetrics(input.ownerUid).catch((error) => {
    dependencies.logError(
      '[syncPublishedPhotoOnPrivateUpdate] Falha ao atualizar métricas.',
      {
        ownerUid: input.ownerUid,
        photoId: input.photoId,
        error: error instanceof Error ? error.message : String(error ?? ''),
      }
    );
  });

  return {
    status: 'synchronized',
    binaryChanged,
    metadataChanged,
    copiedAsset: shouldCopyAsset,
    moderationStatus: dependencies.moderationStatus,
  };
}
