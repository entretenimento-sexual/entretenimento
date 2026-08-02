const PRIVATE_VIDEO_PREFIX = 'uploads/videos';
const PRIVATE_VIDEO_POSTER_PREFIX = 'uploads/video-posters';
const PROCESSED_VIDEO_PREFIX = 'processed/videos';
const PUBLISHED_VIDEO_PREFIX = 'published/videos';

export type PublishedVideoVariantQuality = 'SD' | 'HD';
export type PublishedVideoVariantMimeType = 'video/mp4' | 'video/webm';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeStoragePath(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^\/+/, '');

  if (!normalized || containsControlCharacter(normalized)) {
    return null;
  }

  return normalized;
}

function extractStoragePathFromDownloadUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    const marker = '/o/';
    const markerIndex = parsedUrl.pathname.indexOf(marker);

    if (markerIndex < 0) {
      return null;
    }

    const encodedPath = parsedUrl.pathname.slice(markerIndex + marker.length);
    return normalizeStoragePath(decodeURIComponent(encodedPath));
  } catch {
    return null;
  }
}

function resolveStoragePath(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return extractStoragePathFromDownloadUrl(normalized);
  }

  return normalizeStoragePath(normalized);
}

function matchesOwnedPath(
  ownerUid: string,
  value: unknown,
  suffixPattern: string
): string | null {
  const safeOwnerUid = normalizeId(ownerUid);
  const storagePath = resolveStoragePath(value);

  if (!safeOwnerUid || !storagePath) {
    return null;
  }

  const expectedPath = new RegExp(
    `^users/${escapeRegExp(safeOwnerUid)}/${suffixPattern}$`
  );

  return expectedPath.test(storagePath) ? storagePath : null;
}

function normalizeVariantQuality(
  value: unknown
): PublishedVideoVariantQuality | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'SD' || normalized === 'HD'
    ? normalized
    : null;
}

function extensionForMimeType(
  mimeType: PublishedVideoVariantMimeType
): 'mp4' | 'webm' {
  return mimeType === 'video/webm' ? 'webm' : 'mp4';
}

export function extractOwnedPrivateVideoPath(
  ownerUid: string,
  value: unknown
): string | null {
  return matchesOwnedPath(ownerUid, value, `${PRIVATE_VIDEO_PREFIX}/[^/]+`);
}

export function extractOwnedPrivateVideoPathForId(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);

  if (!safeVideoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PRIVATE_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}-[^/]+`
  );
}

/**
 * Compatibilidade:
 * - assinatura antiga: (ownerUid, value);
 * - assinatura endurecida: (ownerUid, videoId, value).
 */
export function extractOwnedPrivateVideoPosterPath(
  ownerUid: string,
  videoIdOrValue: unknown,
  maybeValue?: unknown
): string | null {
  const hasExplicitVideoId = maybeValue !== undefined;
  const value = hasExplicitVideoId ? maybeValue : videoIdOrValue;
  const safeVideoId = hasExplicitVideoId
    ? normalizeId(videoIdOrValue)
    : null;

  if (hasExplicitVideoId && !safeVideoId) {
    return null;
  }

  const videoSegment = safeVideoId
    ? escapeRegExp(safeVideoId)
    : '[^/]+';

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PRIVATE_VIDEO_POSTER_PREFIX}/${videoSegment}/[^/]+`
  );
}

export function normalizeOwnedProcessedVideoPath(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);

  if (!safeVideoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PROCESSED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/[^/]+/.+`
  );
}

export function normalizeOwnedProcessedVideoPrefix(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);
  const normalized = resolveStoragePath(value)?.replace(/\/+$/, '');

  if (!safeVideoId || !normalized) {
    return null;
  }

  const matched = matchesOwnedPath(
    ownerUid,
    normalized,
    `${PROCESSED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/[^/]+`
  );

  return matched ? `${matched}/` : null;
}

/**
 * Aceita tanto o ativo único legado quanto a nova variante versionada.
 */
export function normalizeOwnedPublishedVideoPath(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);

  if (!safeVideoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PUBLISHED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/` +
      'assets/(?:[^/]+|[^/]+/(?:sd|hd)[.](?:mp4|webm))'
  );
}

export function normalizeOwnedPublishedVideoVariantPath(
  ownerUid: string,
  videoId: string,
  quality: unknown,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);
  const safeQuality = normalizeVariantQuality(quality);

  if (!safeVideoId || !safeQuality) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PUBLISHED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/` +
      `assets/[^/]+/${safeQuality.toLowerCase()}[.](?:mp4|webm)`
  );
}

export function normalizeOwnedPublishedVideoPosterPath(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const safeVideoId = normalizeId(videoId);

  if (!safeVideoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PUBLISHED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/posters/[^/]+`
  );
}

/** Mantido para ativos legados e integrações ainda não migradas. */
export function buildPublishedVideoPath(
  ownerUid: string,
  videoId: string,
  assetVersion: string
): string {
  const safeOwnerUid = normalizeId(ownerUid);
  const safeVideoId = normalizeId(videoId);
  const safeAssetVersion = normalizeId(assetVersion);

  if (!safeOwnerUid || !safeVideoId || !safeAssetVersion) {
    throw new Error('Identificadores inválidos para publicação de vídeo.');
  }

  return (
    `users/${safeOwnerUid}/${PUBLISHED_VIDEO_PREFIX}/${safeVideoId}/` +
    `assets/${safeAssetVersion}`
  );
}

export function buildPublishedVideoVariantPath(
  ownerUid: string,
  videoId: string,
  assetVersion: string,
  quality: PublishedVideoVariantQuality,
  mimeType: PublishedVideoVariantMimeType
): string {
  const safeOwnerUid = normalizeId(ownerUid);
  const safeVideoId = normalizeId(videoId);
  const safeAssetVersion = normalizeId(assetVersion);
  const safeQuality = normalizeVariantQuality(quality);

  if (!safeOwnerUid || !safeVideoId || !safeAssetVersion || !safeQuality) {
    throw new Error('Identificadores inválidos para variante publicada.');
  }

  return (
    `users/${safeOwnerUid}/${PUBLISHED_VIDEO_PREFIX}/${safeVideoId}/` +
    `assets/${safeAssetVersion}/${safeQuality.toLowerCase()}.` +
    extensionForMimeType(mimeType)
  );
}

export function buildPublishedVideoPosterPath(
  ownerUid: string,
  videoId: string,
  assetVersion: string
): string {
  const safeOwnerUid = normalizeId(ownerUid);
  const safeVideoId = normalizeId(videoId);
  const safeAssetVersion = normalizeId(assetVersion);

  if (!safeOwnerUid || !safeVideoId || !safeAssetVersion) {
    throw new Error('Identificadores inválidos para publicação do poster.');
  }

  return (
    `users/${safeOwnerUid}/${PUBLISHED_VIDEO_PREFIX}/${safeVideoId}/` +
    `posters/${safeAssetVersion}`
  );
}
