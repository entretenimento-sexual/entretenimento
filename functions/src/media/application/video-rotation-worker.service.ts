import axios from 'axios';

import { storage } from '../../firebaseApp';
import { assertExternalVideoEgressAllowed } from '../../shared/runtime/functions-runtime.guard';
import {
  withoutVideoRotation,
  type VideoEditRecipe,
} from './video-edit-recipe';
import type { VideoProcessingJob } from './video-processing-job';

interface RotationWorkerResponse {
  destinationStoragePath?: string;
}

export interface PreparedTranscoderSource {
  sourceStoragePath: string;
  recipe: VideoEditRecipe;
}

export interface AuthoritativeVideoProbeResult {
  widthPixels: number;
  heightPixels: number;
  durationMs: number;
  embeddedRotationDegrees: number;
  displayAspectNumerator: number;
  displayAspectDenominator: number;
  sampleAspectRatio: { numerator: number; denominator: number };
  videoCodec: string;
  hasAudio: boolean;
  audioCodec: string | null;
  sourceGeneration: string;
  sourceSizeBytes: number;
}

export class VideoProbeRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = 'VideoProbeRequestError';
  }
}

/** Consulta explícita e versionada; não altera ainda a receita do Transcoder. */
export async function probeVideoSource(
  job: VideoProcessingJob
): Promise<AuthoritativeVideoProbeResult> {
  const generation = String(job.sourceGeneration ?? '').trim();
  if (!/^[1-9][0-9]{0,29}$/.test(generation)) {
    throw new VideoProbeRequestError(
      'VIDEO_PROBE_SOURCE_GENERATION_UNAVAILABLE', false
    );
  }
  const baseUrl = workerBaseUrl();
  if (!baseUrl) {
    throw new VideoProbeRequestError('VIDEO_PROBE_WORKER_UNAVAILABLE', true);
  }
  try {
    const authorization = await workerAuthorizationHeader(baseUrl);
    const response = await axios.post<AuthoritativeVideoProbeResult>(
      baseUrl + '/probe',
      {
        bucketName: storage.bucket().name,
        ownerUid: job.ownerUid,
        videoId: job.videoId,
        processingVersion: job.processingVersion,
        sourceStoragePath: job.sourceStoragePath,
        sourceGeneration: generation,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        timeout: 70_000,
      }
    );
    const result = response.data;
    if (result?.sourceGeneration !== generation ||
        !Number.isSafeInteger(result.widthPixels) ||
        !Number.isSafeInteger(result.heightPixels) ||
        !Number.isSafeInteger(result.durationMs) ||
        result.widthPixels < 2 || result.heightPixels < 2 ||
        result.durationMs < 5_000 ||
        typeof result.hasAudio !== 'boolean') {
      throw new VideoProbeRequestError('VIDEO_PROBE_INVALID_RESPONSE', true);
    }
    return result;
  } catch (error) {
    if (error instanceof VideoProbeRequestError) throw error;
    const responseCode = axios.isAxiosError(error)
      ? (error.response?.data as { error?: unknown } | undefined)?.error
      : null;
    const code = typeof responseCode === 'string' &&
      /^VIDEO_PROBE_[A-Z0-9_]{1,80}$/.test(responseCode)
      ? responseCode : 'VIDEO_PROBE_WORKER_UNAVAILABLE';
    const retryable = [
      'VIDEO_PROBE_WORKER_UNAVAILABLE',
      'VIDEO_PROBE_UNAVAILABLE',
      'VIDEO_PROBE_TIMEOUT',
    ].includes(code);
    throw new VideoProbeRequestError(code, retryable);
  }
}

const METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/' +
  'instance/service-accounts/default/identity';
const ROTATION_WORKER_TIMEOUT_MS = 8 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanProcessingVersion(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(normalized) ? normalized : '';
}

function workerBaseUrl(): string | null {
  const value = String(process.env.VIDEO_ROTATION_WORKER_URL ?? '')
    .trim()
    .replace(/\/+$/, '');

  if (!value) {
    return null;
  }

  if (
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)
  ) {
    return value;
  }

  if (/^https:\/\//i.test(value)) {
    assertExternalVideoEgressAllowed();
    return value;
  }

  throw new Error('URL segura do worker de rotação não configurada.');
}

export function buildRotationSourceStoragePath(
  job: Pick<VideoProcessingJob, 'ownerUid' | 'videoId' | 'processingVersion'>
): string {
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const processingVersion = cleanProcessingVersion(job.processingVersion);

  if (!ownerUid || !videoId || !processingVersion) {
    throw new Error('Identificadores inválidos para o temporário de rotação.');
  }

  return (
    `users/${ownerUid}/processed/video-rotation-sources/${videoId}/` +
    `${processingVersion}/source.mp4`
  );
}

async function workerAuthorizationHeader(baseUrl: string): Promise<string | null> {
  if (
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)
  ) {
    return null;
  }

  const response = await axios.get<string>(METADATA_IDENTITY_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
    params: {
      audience: baseUrl,
      format: 'full',
    },
    timeout: 5_000,
    responseType: 'text',
  });
  const token = String(response.data ?? '').trim();

  if (!token) {
    throw new Error('Token de identidade do worker de rotação não foi obtido.');
  }

  return `Bearer ${token}`;
}

async function storedRotationSourceIsReady(storagePath: string): Promise<boolean> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    return false;
  }

  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata.size ?? 0);
  const contentType = String(metadata.contentType ?? '').trim().toLowerCase();

  return Number.isFinite(sizeBytes) &&
    sizeBytes > 0 &&
    contentType === 'video/mp4';
}

export async function prepareVideoSourceForTranscoder(
  job: VideoProcessingJob,
  recipe: VideoEditRecipe
): Promise<PreparedTranscoderSource> {
  if (recipe.rotationDegrees === 0) {
    return {
      sourceStoragePath: job.sourceStoragePath,
      recipe,
    };
  }

  const baseUrl = workerBaseUrl();

  if (!baseUrl) {
    throw new Error(
      'O processamento de rotação não está configurado no ambiente.'
    );
  }

  const destinationStoragePath = buildRotationSourceStoragePath(job);

  if (!(await storedRotationSourceIsReady(destinationStoragePath))) {
    const authorization = await workerAuthorizationHeader(baseUrl);
    const response = await axios.post<RotationWorkerResponse>(
      `${baseUrl}/rotate`,
      {
        bucketName: storage.bucket().name,
        ownerUid: job.ownerUid,
        videoId: job.videoId,
        processingVersion: job.processingVersion,
        sourceStoragePath: job.sourceStoragePath,
        destinationStoragePath,
        rotationDegrees: recipe.rotationDegrees,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        timeout: ROTATION_WORKER_TIMEOUT_MS,
      }
    );

    if (response.data?.destinationStoragePath !== destinationStoragePath) {
      throw new Error('O worker de rotação retornou um destino inesperado.');
    }

    if (!(await storedRotationSourceIsReady(destinationStoragePath))) {
      throw new Error('O worker de rotação não gerou um arquivo válido.');
    }
  }

  return {
    sourceStoragePath: destinationStoragePath,
    recipe: withoutVideoRotation(recipe),
  };
}
