import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '../media-format.generated';

export type CanonicalPublishedPhotoFormat = 'jpeg' | 'png' | 'webp';

export const PUBLISHED_PHOTO_MAX_INPUT_EDGE = 8192;
export const PUBLISHED_PHOTO_MAX_INPUT_PIXELS = 40_000_000;
export const PUBLISHED_PHOTO_MAX_OUTPUT_EDGE = 4096;
export const PUBLISHED_PHOTO_MAX_OUTPUT_BYTES = IMAGE_MAX_BYTES;

const ALLOWED_INPUT_CONTENT_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);

const MIME_TO_FORMAT = new Map<string, CanonicalPublishedPhotoFormat>([
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const FORMAT_TO_MIME = new Map<CanonicalPublishedPhotoFormat, string>([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

export interface PublishedPhotoDecodedMetadata {
  format?: string | null;
  width?: number | null;
  height?: number | null;
  pages?: number | null;
}

export interface CanonicalPublishedPhotoMetadata {
  format: CanonicalPublishedPhotoFormat;
  outputContentType: string;
  width: number;
  height: number;
}

export function normalizePublishedPhotoInputContentType(
  value: unknown
): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ALLOWED_INPUT_CONTENT_TYPES.has(normalized) ? normalized : null;
}

export function assertPublishedPhotoSourceMetadata(input: {
  contentType: unknown;
  sizeBytes: unknown;
}): {
  contentType: string;
  sizeBytes: number;
  expectedFormat: CanonicalPublishedPhotoFormat;
} {
  const contentType = normalizePublishedPhotoInputContentType(input.contentType);
  const sizeBytes = Number(input.sizeBytes ?? 0);

  if (!contentType) {
    throw new Error('O arquivo privado não possui um formato de imagem suportado.');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho da imagem privada.');
  }
  if (sizeBytes > IMAGE_MAX_BYTES) {
    throw new Error('A imagem privada excede o limite permitido para publicação.');
  }

  const expectedFormat = MIME_TO_FORMAT.get(contentType);
  if (!expectedFormat) {
    throw new Error('O formato declarado da imagem não possui saída publicada canônica.');
  }

  return {
    contentType,
    sizeBytes: Math.trunc(sizeBytes),
    expectedFormat,
  };
}

export function assertPublishedPhotoDecodedMetadata(
  metadata: PublishedPhotoDecodedMetadata,
  expectedFormat: CanonicalPublishedPhotoFormat
): CanonicalPublishedPhotoMetadata {
  const format = String(metadata.format ?? '')
    .trim()
    .toLowerCase() as CanonicalPublishedPhotoFormat;
  const width = Number(metadata.width ?? 0);
  const height = Number(metadata.height ?? 0);
  const pages = Number(metadata.pages ?? 1);

  if (!FORMAT_TO_MIME.has(format) || format !== expectedFormat) {
    throw new Error('O conteúdo real da imagem não corresponde ao formato declarado.');
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('Não foi possível validar as dimensões da imagem privada.');
  }
  if (
    width > PUBLISHED_PHOTO_MAX_INPUT_EDGE ||
    height > PUBLISHED_PHOTO_MAX_INPUT_EDGE
  ) {
    throw new Error('A imagem excede a dimensão máxima permitida para publicação.');
  }
  if (width * height > PUBLISHED_PHOTO_MAX_INPUT_PIXELS) {
    throw new Error('A imagem excede a quantidade máxima de pixels permitida.');
  }
  if (!Number.isFinite(pages) || pages !== 1) {
    throw new Error('Somente imagens estáticas de um único quadro podem ser publicadas.');
  }

  return {
    format,
    outputContentType: FORMAT_TO_MIME.get(format) as string,
    width,
    height,
  };
}

export function assertPublishedPhotoOutput(input: {
  sizeBytes: unknown;
  width: unknown;
  height: unknown;
}): void {
  const sizeBytes = Number(input.sizeBytes ?? 0);
  const width = Number(input.width ?? 0);
  const height = Number(input.height ?? 0);

  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > PUBLISHED_PHOTO_MAX_OUTPUT_BYTES
  ) {
    throw new Error('A imagem sanitizada excede o limite permitido para publicação.');
  }

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > PUBLISHED_PHOTO_MAX_OUTPUT_EDGE ||
    height > PUBLISHED_PHOTO_MAX_OUTPUT_EDGE
  ) {
    throw new Error('A imagem sanitizada possui dimensões inválidas.');
  }
}
