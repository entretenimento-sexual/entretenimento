import { createHash } from 'node:crypto';

import { storage } from '../../firebaseApp';

const DOWNLOAD_TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens';

function storageEmulatorBaseUrl(): string {
  const configuredHost = String(
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'
  ).trim();

  return /^https?:\/\//i.test(configuredHost)
    ? configuredHost
    : `http://${configuredHost}`;
}

function firstDownloadToken(value: unknown): string | null {
  return String(value ?? '')
    .split(',')
    .map((token) => token.trim())
    .find(Boolean) ?? null;
}

function deterministicEmulatorToken(
  bucketName: string,
  storagePath: string
): string {
  const digest = createHash('sha256')
    .update(`firebase-storage-emulator:${bucketName}:${storagePath}`)
    .digest('hex');

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

async function ensureEmulatorDownloadToken(storagePath: string): Promise<string> {
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();
  const customMetadata = metadata.metadata &&
    typeof metadata.metadata === 'object'
    ? metadata.metadata as Record<string, string>
    : {};
  const existingToken = firstDownloadToken(
    customMetadata[DOWNLOAD_TOKEN_METADATA_KEY]
  );

  if (existingToken) {
    return existingToken;
  }

  const token = deterministicEmulatorToken(bucket.name, storagePath);

  await file.setMetadata({
    metadata: {
      ...customMetadata,
      [DOWNLOAD_TOKEN_METADATA_KEY]: token,
    },
  });

  return token;
}

function buildStorageEmulatorUrl(
  storagePath: string,
  downloadToken: string
): string {
  const bucketName = storage.bucket().name;
  const encodedBucket = encodeURIComponent(bucketName);
  const encodedPath = encodeURIComponent(storagePath);
  const encodedToken = encodeURIComponent(downloadToken);

  return (
    `${storageEmulatorBaseUrl()}/v0/b/${encodedBucket}/o/${encodedPath}` +
    `?alt=media&token=${encodedToken}`
  );
}

/**
 * Em produção, emite uma URL V4 com expiração real.
 * No Storage Emulator, garante um download token técnico no próprio objeto,
 * pois o endpoint alt=media continua sujeito às Storage Rules quando não há
 * token. O token é determinístico para evitar invalidação entre chamadas
 * concorrentes e existe somente no ambiente emulado.
 */
export async function createTemporaryStorageReadUrl(
  storagePath: string,
  expiresAt: number
): Promise<string> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const downloadToken = await ensureEmulatorDownloadToken(storagePath);
    return buildStorageEmulatorUrl(storagePath, downloadToken);
  }

  const [signedUrl] = await storage
    .bucket()
    .file(storagePath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

  return signedUrl;
}
