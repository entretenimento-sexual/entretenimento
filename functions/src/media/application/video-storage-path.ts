const PRIVATE_VIDEO_PREFIX = 'uploads/videos';
const PRIVATE_IMAGE_PREFIX = 'uploads/images';
const PUBLISHED_VIDEO_PREFIX = 'published/videos';

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

export function extractOwnedPrivateVideoPath(
  ownerUid: string,
  value: unknown
): string | null {
  return matchesOwnedPath(ownerUid, value, `${PRIVATE_VIDEO_PREFIX}/[^/]+`);
}

export function extractOwnedPrivateVideoPosterPath(
  ownerUid: string,
  value: unknown
): string | null {
  return matchesOwnedPath(ownerUid, value, `${PRIVATE_IMAGE_PREFIX}/[^/]+`);
}

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
    `${PUBLISHED_VIDEO_PREFIX}/${escapeRegExp(safeVideoId)}/assets/[^/]+`
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

  return `users/${safeOwnerUid}/${PUBLISHED_VIDEO_PREFIX}/${safeVideoId}/assets/${safeAssetVersion}`;
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

  return `users/${safeOwnerUid}/${PUBLISHED_VIDEO_PREFIX}/${safeVideoId}/posters/${safeAssetVersion}`;
}
