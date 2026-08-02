export const SUPPORTED_VIDEO_UPLOAD_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const);

const SUPPORTED_VIDEO_UPLOAD_MIME_TYPE_SET = new Set<string>(
  SUPPORTED_VIDEO_UPLOAD_MIME_TYPES
);

export function normalizeVideoUploadMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isSupportedVideoUploadMimeType(value: unknown): boolean {
  return SUPPORTED_VIDEO_UPLOAD_MIME_TYPE_SET.has(
    normalizeVideoUploadMimeType(value)
  );
}
