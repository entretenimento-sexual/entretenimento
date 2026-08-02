export const NEW_VIDEO_UPLOAD_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export type NewVideoUploadMimeType =
  (typeof NEW_VIDEO_UPLOAD_MIME_TYPES)[number];

const NEW_VIDEO_UPLOAD_TYPE_SET = new Set<string>(
  NEW_VIDEO_UPLOAD_MIME_TYPES
);

/**
 * Tipos reconhecidos apenas para preservar documentos e retries idempotentes
 * anteriores ao endurecimento do upload. Eles não podem registrar uploads novos.
 */
const RECOGNIZED_LEGACY_VIDEO_TYPE_SET = new Set<string>([
  ...NEW_VIDEO_UPLOAD_MIME_TYPES,
  'video/x-matroska',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'video/mp2t',
  'application/mxf',
]);

const DIRECT_PUBLIC_PLAYBACK_TYPE_SET = new Set<string>([
  'video/mp4',
  'video/webm',
]);

export function normalizeVideoUploadMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isAllowedNewVideoUploadMimeType(value: unknown): boolean {
  return NEW_VIDEO_UPLOAD_TYPE_SET.has(
    normalizeVideoUploadMimeType(value)
  );
}

export function isRecognizedRegisteredVideoMimeType(value: unknown): boolean {
  return RECOGNIZED_LEGACY_VIDEO_TYPE_SET.has(
    normalizeVideoUploadMimeType(value)
  );
}

export function isDirectPublicPlaybackMimeType(value: unknown): boolean {
  return DIRECT_PUBLIC_PLAYBACK_TYPE_SET.has(
    normalizeVideoUploadMimeType(value)
  );
}
