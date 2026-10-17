/**
 * A version-specific, create-only GCS copy prevents Transcoder's mutable gs://
 * input URI from resolving a newer upload after the source was probed.
 * No provider call is authorized by this module; the caller must re-check
 * Firestore processingVersion, sourceGeneration and cancellation immediately
 * before a Transcoder POST. A separate cleanup flow is also required.
 */
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';
import { matchesVideoSourceProbeSnapshot } from './video-source-probe.policy';
import type { VideoProcessingJob } from './video-processing-job';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION = /^[A-Za-z0-9_-]{1,160}$/;
const GENERATION = /^[1-9][0-9]{0,29}$/;
const CRC32C = /^[A-Za-z0-9+/]{6,8}={0,2}$/;
const MAX_BYTES = 500 * 1024 * 1024;

export type ImmutableInputJob = Pick<VideoProcessingJob,
  'ownerUid' | 'videoId' | 'processingVersion' | 'sourceStoragePath' |
  'sourceGeneration' | 'sourceSizeBytes' | 'sourceMimeType' | 'sourceProbe'>;

export interface GcsObjectSnapshot {
  readonly generation: string;
  readonly size: string;
  readonly crc32c: string;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ImmutableInputCopyCommand {
  readonly sourcePath: string;
  readonly sourceGeneration: string;
  readonly destinationPath: string;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly ifDestinationGenerationMatch: 0;
}

/** Injectable boundary: keep the policy testable without cloud credentials. */
export interface ImmutableInputStoragePort {
  readPinnedSource(path: string, generation: string): Promise<GcsObjectSnapshot | null>;
  readDestination(path: string): Promise<GcsObjectSnapshot | null>;
  copyPinnedSource(command: ImmutableInputCopyCommand): Promise<void>;
}

export interface ImmutableTranscoderInput {
  readonly sourceStoragePath: string;
  readonly sourceGeneration: string;
  readonly destinationStoragePath: string;
  readonly destinationGeneration: string;
  readonly sizeBytes: number;
  readonly crc32c: string;
  readonly reused: boolean;
}

/** Pure, version-scoped source selection. No GCS calls and no provider POST. */
export type TranscoderInputSourceSelection = Readonly<
  | { mode: 'legacy'; sourceStoragePath: string }
  | { mode: 'immutable'; sourceStoragePath: string; sourceGeneration: string;
      destinationGeneration: string; sizeBytes: number; crc32c: string }
>;

/** Shared authority for persisted copy identity across scheduler and preflight. */
export function matchesPersistedImmutableInput(
  job: VideoProcessingJob, input: unknown
): boolean {
  if (!input || typeof input !== 'object' ||
      !GENERATION.test(String(job.sourceGeneration ?? '')) ||
      !matchesVideoSourceProbeSnapshot(job, job.sourceProbe)) return false;
  const stored = input as Partial<ImmutableTranscoderInput>;
  try {
    return stored.sourceStoragePath === job.sourceStoragePath &&
      stored.sourceGeneration === job.sourceGeneration &&
      stored.destinationStoragePath === buildImmutableTranscoderInputPath(job) &&
      GENERATION.test(String(stored.destinationGeneration ?? '')) &&
      stored.sizeBytes === job.sourceSizeBytes &&
      typeof stored.crc32c === 'string' &&
      CRC32C.test(stored.crc32c);
  } catch {
    return false;
  }
}

/**
 * Select the only admissible source. Until lifecycle/rotation/POST are fenced,
 * this decision is consumed exclusively at the claim guard, never at POST.
 * Existing jobs without a sourceGeneration remain legacy-compatible.
 */
export function selectTranscoderInputSource(
  job: VideoProcessingJob, immutableInputRequired: boolean
): TranscoderInputSourceSelection | null {
  if (!immutableInputRequired || job.sourceGeneration == null) {
    return { mode: 'legacy', sourceStoragePath: job.sourceStoragePath };
  }
  if (!matchesPersistedImmutableInput(job, job.immutableInput)) return null;
  const input = job.immutableInput!;
  return {
    mode: 'immutable',
    sourceStoragePath: input.destinationStoragePath,
    sourceGeneration: input.sourceGeneration,
    destinationGeneration: input.destinationGeneration,
    sizeBytes: input.sizeBytes,
    crc32c: input.crc32c,
  };
}

export class ImmutableInputPreparationError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = 'ImmutableInputPreparationError';
  }
}

function fail(code: string, retryable = false): never {
  throw new ImmutableInputPreparationError(code, retryable);
}

export function buildImmutableTranscoderInputPath(job: ImmutableInputJob): string {
  if (!ID.test(job.ownerUid) || !ID.test(job.videoId) ||
      !VERSION.test(job.processingVersion) ||
      extractOwnedPrivateVideoPathForId(job.ownerUid, job.videoId,
        job.sourceStoragePath) !== job.sourceStoragePath ||
      !GENERATION.test(String(job.sourceGeneration ?? ''))) {
    return fail('IMMUTABLE_INPUT_IDENTITY_INVALID');
  }
  const extension = job.sourceMimeType === 'video/mp4'
    ? '.mp4' : job.sourceMimeType === 'video/webm' ? '.webm' : null;
  if (!extension) return fail('IMMUTABLE_INPUT_TYPE_INVALID');
  // Intentionally outside job.outputPrefix: output discovery must NEVER pick
  // this copy as the Transcoder's newly generated playable derivative.
  return `users/${job.ownerUid}/processed/video-transcoder-inputs/` +
    `${job.videoId}/${job.processingVersion}/source${extension}`;
}

function validatePinnedSource(job: ImmutableInputJob,
  source: GcsObjectSnapshot | null): asserts source is GcsObjectSnapshot {
  if (!source || source.generation !== job.sourceGeneration) {
    fail('IMMUTABLE_INPUT_SOURCE_CHANGED');
  }
  if (!Number.isSafeInteger(job.sourceSizeBytes) || job.sourceSizeBytes <= 0 ||
      job.sourceSizeBytes > MAX_BYTES ||
      source.size !== String(job.sourceSizeBytes) ||
      source.contentType !== job.sourceMimeType ||
      !CRC32C.test(source.crc32c)) {
    fail('IMMUTABLE_INPUT_SOURCE_CHANGED');
  }
}

function compatibleDestination(
  job: ImmutableInputJob,
  source: GcsObjectSnapshot,
  destination: GcsObjectSnapshot | null
): destination is GcsObjectSnapshot {
  const metadata = destination?.metadata;
  return !!destination && GENERATION.test(destination.generation) &&
    destination.size === source.size && destination.crc32c === source.crc32c &&
    destination.contentType === source.contentType &&
    metadata?.['source'] === 'video-immutable-transcoder-input' &&
    metadata['processingVersion'] === job.processingVersion &&
    metadata['sourceStoragePath'] === job.sourceStoragePath &&
    metadata['sourceGeneration'] === job.sourceGeneration &&
    metadata['sourceCrc32c'] === source.crc32c;
}

function httpCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = Number(error.code);
  return Number.isInteger(code) ? code : null;
}

/**
 * Idempotent GCS copy; source generation remains a STRING (no IEEE-754 loss).
 * A pre-existing destination is reused only after strict identity + CRC checks.
 */
export async function prepareImmutableTranscoderInputWithPort(
  job: ImmutableInputJob,
  port: ImmutableInputStoragePort
): Promise<ImmutableTranscoderInput> {
  const destinationPath = buildImmutableTranscoderInputPath(job);
  if (!matchesVideoSourceProbeSnapshot(job, job.sourceProbe)) {
    fail('IMMUTABLE_INPUT_PROBE_NOT_CURRENT');
  }
  const generation = String(job.sourceGeneration);
  let source: GcsObjectSnapshot | null;
  try {
    source = await port.readPinnedSource(job.sourceStoragePath, generation);
  } catch (error) {
    if (httpCode(error) === 404) fail('IMMUTABLE_INPUT_SOURCE_CHANGED');
    fail('IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE', true);
  }
  validatePinnedSource(job, source);

  const result = (destination: GcsObjectSnapshot, reused: boolean): ImmutableTranscoderInput => ({
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: generation,
    destinationStoragePath: destinationPath,
    destinationGeneration: destination.generation,
    sizeBytes: job.sourceSizeBytes,
    crc32c: source.crc32c,
    reused,
  });

  let existing: GcsObjectSnapshot | null;
  try {
    existing = await port.readDestination(destinationPath);
  } catch {
    fail('IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE', true);
  }
  if (existing) {
    if (!compatibleDestination(job, source, existing)) {
      fail('IMMUTABLE_INPUT_DESTINATION_CONFLICT');
    }
    return result(existing, true);
  }

  const command: ImmutableInputCopyCommand = {
    sourcePath: job.sourceStoragePath,
    sourceGeneration: generation,
    destinationPath,
    contentType: job.sourceMimeType,
    ifDestinationGenerationMatch: 0,
    metadata: {
      source: 'video-immutable-transcoder-input',
      processingVersion: job.processingVersion,
      sourceStoragePath: job.sourceStoragePath,
      sourceGeneration: generation,
      sourceCrc32c: source.crc32c,
    },
  };
  let copyHadAmbiguousResult = false;
  try {
    await port.copyPinnedSource(command);
  } catch (error) {
    copyHadAmbiguousResult = true;
    const code = httpCode(error);
    // A 412 can mean a competing writer successfully created the same copy.
    // Re-read regardless; even ambiguous network failures may have committed.
    if (code === 404) fail('IMMUTABLE_INPUT_SOURCE_CHANGED');
  }
  let created: GcsObjectSnapshot | null;
  try {
    created = await port.readDestination(destinationPath);
  } catch {
    fail('IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE', true);
  }
  if (!created) fail('IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE', true);
  if (!compatibleDestination(job, source, created)) {
    fail('IMMUTABLE_INPUT_DESTINATION_CONFLICT');
  }
  return result(created, copyHadAmbiguousResult);
}
