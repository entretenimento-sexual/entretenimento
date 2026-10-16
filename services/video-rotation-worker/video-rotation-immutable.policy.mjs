/**
 * Strict opt-in contract: the rotation worker can read a preverified, pinned
 * GCS object instead of the mutable original upload. All inputs are provided
 * by the authenticated Functions caller and checked against GCS metadata.
 * No field in this module authorizes a Transcoder POST.
 */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION = /^[A-Za-z0-9_-]{1,160}$/;
const GENERATION = /^[1-9][0-9]{0,29}$/;
const CRC32C = /^[A-Za-z0-9+/]{6,8}={0,2}$/;
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
const MAX_ROTATED_BYTES = 750 * 1024 * 1024;

export class ImmutableRotationInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ImmutableRotationInputError';
    this.code = code;
  }
}

function reject(code) {
  throw new ImmutableRotationInputError(code);
}

function validOriginalPath(ownerUid, videoId, path) {
  return typeof path === 'string' &&
    path.startsWith(`users/${ownerUid}/uploads/videos/${videoId}-`) &&
    new RegExp(`^users/${ownerUid}/uploads/videos/${videoId}-[^/]+\\.[A-Za-z0-9]{2,8}$`).test(path);
}

/** Check the input against the *same* per-job name used by the copy service. */
export function requireImmutableRotationInput(payload, originalPath) {
  const { ownerUid, videoId, processingVersion } = payload ?? {};
  const i = payload?.immutableInput;
  if (!ID.test(String(ownerUid ?? '')) || !ID.test(String(videoId ?? '')) ||
      !VERSION.test(String(processingVersion ?? '')) || !i ||
      typeof i !== 'object' || Array.isArray(i) ||
      !validOriginalPath(ownerUid, videoId, originalPath) ||
      i.sourceStoragePath !== originalPath ||
      !GENERATION.test(String(i.sourceGeneration ?? '')) ||
      !GENERATION.test(String(i.destinationGeneration ?? '')) ||
      !Number.isSafeInteger(i.sizeBytes) || i.sizeBytes < 1 ||
      i.sizeBytes > MAX_SOURCE_BYTES ||
      typeof i.crc32c !== 'string' || !CRC32C.test(i.crc32c)) {
    reject('IMMUTABLE_ROTATION_INVALID_INPUT');
  }
  const prefix = `users/${ownerUid}/processed/video-transcoder-inputs/` +
    `${videoId}/${processingVersion}/source`;
  const accepted = i.destinationStoragePath === `${prefix}.mp4` ||
    i.destinationStoragePath === `${prefix}.webm`;
  if (!accepted) reject('IMMUTABLE_ROTATION_INVALID_INPUT');
  return Object.freeze({
    ...i,
    processingVersion,
    sourceContentType: i.destinationStoragePath.endsWith('.mp4')
      ? 'video/mp4' : 'video/webm',
  });
}

export function matchesImmutableRotationSource(input, raw) {
  const m = raw?.metadata;
  return !!raw && !!m &&
    String(raw.generation ?? '') === input.destinationGeneration &&
    String(raw.size ?? '') === String(input.sizeBytes) &&
    String(raw.crc32c ?? '') === input.crc32c &&
    String(raw.contentType ?? '').trim().toLowerCase() === input.sourceContentType &&
    m.source === 'video-immutable-transcoder-input' &&
    m.processingVersion === input.processingVersion &&
    m.sourceStoragePath === input.sourceStoragePath &&
    m.sourceGeneration === input.sourceGeneration &&
    m.sourceCrc32c === input.crc32c;
}

export function immutableRotationOutputMetadata(input, rotationDegrees) {
  return Object.freeze({
    source: 'video-rotation-worker',
    processingVersion: input.processingVersion,
    rotationDegrees: String(rotationDegrees),
    immutableInputStoragePath: input.destinationStoragePath,
    immutableInputGeneration: input.destinationGeneration,
    immutableInputCrc32c: input.crc32c,
  });
}

export function matchesImmutableRotationDestination(input, rotationDegrees, raw) {
  const expected = immutableRotationOutputMetadata(input, rotationDegrees);
  const m = raw?.metadata;
  const sizeBytes = Number(raw?.size ?? 0);
  if (!raw || !m || !GENERATION.test(String(raw.generation ?? '')) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 ||
      sizeBytes > MAX_ROTATED_BYTES ||
      String(raw.contentType ?? '').trim().toLowerCase() !== 'video/mp4') {
    return false;
  }
  return Object.entries(expected).every(([key, value]) => m[key] === value);
}
