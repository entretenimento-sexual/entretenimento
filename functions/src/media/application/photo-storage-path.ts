const PRIVATE_PREFIX = 'uploads/images';
const PUBLISHED_PREFIX = 'published/images';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeStoragePath(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^\/+/, '');

  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
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

export function extractOwnedPrivatePhotoPath(
  ownerUid: string,
  value: unknown
): string | null {
  return matchesOwnedPath(ownerUid, value, `${PRIVATE_PREFIX}/[^/]+`);
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
