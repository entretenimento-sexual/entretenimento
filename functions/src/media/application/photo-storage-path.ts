const PRIVATE_PREFIX = 'uploads/images';
const PUBLISHED_PREFIX = 'published/images';
const PRIVATE_SOURCE_SLOTS = new Set(['source-a', 'source-b']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsControlCharacter(value: string): boolean {
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

/**
 * Mantém compatibilidade com objetos legados no formato plano e reconhece os
 * dois slots limitados usados pelos uploads atuais.
 */
export function extractOwnedPrivatePhotoPath(
  ownerUid: string,
  value: unknown
): string | null {
  return matchesOwnedPath(
    ownerUid,
    value,
    `${PRIVATE_PREFIX}/(?:[^/]+|[^/]+/(?:source-a|source-b))`
  );
}

/**
 * Para novos uploads, o photoId precisa fazer parte do path e o arquivo só pode
 * ocupar um dos dois slots fixos. Isso impede namespaces arbitrários por foto.
 */
export function extractOwnedPrivatePhotoPathForId(
  ownerUid: string,
  photoId: string,
  value: unknown
): string | null {
  const safePhotoId = normalizeId(photoId);

  if (!safePhotoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PRIVATE_PREFIX}/${escapeRegExp(safePhotoId)}/(?:source-a|source-b)`
  );
}

export function parseOwnedPrivatePhotoStagingPath(value: unknown): {
  ownerUid: string;
  photoId: string;
  slot: 'source-a' | 'source-b';
} | null {
  const storagePath = resolveStoragePath(value);
  const match = storagePath?.match(
    /^users\/([^/]+)\/uploads\/images\/([^/]+)\/(source-a|source-b)$/
  );

  if (!match) {
    return null;
  }

  const ownerUid = normalizeId(match[1]);
  const photoId = normalizeId(match[2]);
  const slot = match[3];

  if (
    !ownerUid ||
    !photoId ||
    !PRIVATE_SOURCE_SLOTS.has(slot)
  ) {
    return null;
  }

  return {
    ownerUid,
    photoId,
    slot: slot as 'source-a' | 'source-b',
  };
}

export function normalizeOwnedPublishedPhotoPath(
  ownerUid: string,
  photoId: string,
  value: unknown
): string | null {
  const safePhotoId = normalizeId(photoId);

  if (!safePhotoId) {
    return null;
  }

  return matchesOwnedPath(
    ownerUid,
    value,
    `${PUBLISHED_PREFIX}/${escapeRegExp(safePhotoId)}/[^/]+`
  );
}

export function buildPublishedPhotoPath(
  ownerUid: string,
  photoId: string,
  assetVersion: string
): string {
  const safeOwnerUid = normalizeId(ownerUid);
  const safePhotoId = normalizeId(photoId);
  const safeAssetVersion = normalizeId(assetVersion);

  if (!safeOwnerUid || !safePhotoId || !safeAssetVersion) {
    throw new Error('Identificadores inválidos para publicação de foto.');
  }

  return `users/${safeOwnerUid}/${PUBLISHED_PREFIX}/${safePhotoId}/${safeAssetVersion}`;
}
