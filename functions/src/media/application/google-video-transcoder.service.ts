import axios from 'axios';
import { applicationDefault } from 'firebase-admin/app';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { adminApp, db, storage } from '../../firebaseApp';
import { assertExternalVideoEgressAllowed } from '../../shared/runtime/functions-runtime.guard';
import {
  buildEditedTranscoderJobConfig,
  buildNeutralSingleMp4Config,
} from './google-video-transcoder-edit-config';
import {
  normalizeVideoEditRecipe,
  type VideoEditRecipe,
} from './video-edit-recipe';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import { prepareVideoSourceForTranscoder } from './video-rotation-worker.service';
import { videoSourceProbeCaptureEnabled } from './video-source-probe.service';
import { submitAfterTranscoderPostGuard } from './video-transcoder-post-guard.policy';
import { lookupUniqueTranscoderJob } from './google-video-transcoder-lookup.policy';
import { deleteVideoTranscoderJobWithTransport } from './video-transcoder-delete.transport';

interface GoogleTranscoderErrorStatus {
  code?: number;
  message?: string;
  status?: string;
}

interface GoogleTranscoderJobResponse {
  name?: string;
  state?: string;
  labels?: Record<string, string>;
  error?: GoogleTranscoderErrorStatus | null;
}

interface GoogleTranscoderListJobsResponse {
  jobs?: GoogleTranscoderJobResponse[];
  nextPageToken?: string;
}

interface PersistedVideoEditSnapshot {
  recipe: VideoEditRecipe;
  sourceDurationMs: number | null;
}

/**
 * HTTP success without a valid job ID is ambiguous: the provider may have
 * created a billable job. Never classify it as an ordinary retryable failure.
 */
export class AmbiguousTranscoderSubmissionError extends Error {
  constructor() {
    super('O Transcoder pode ter recebido o job, mas não devolveu um ID.');
    this.name = 'AmbiguousTranscoderSubmissionError';
  }
}

export interface GoogleTranscoderJobSnapshot {
  name: string;
  state: string;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface NormalizedTranscoderError {
  code: string;
  message: string;
  retryable: boolean;
}

export type GoogleVideoTranscoderProbeStatus =
  | 'READY'
  | 'EMULATOR_SKIPPED'
  | 'UNAVAILABLE';

export interface GoogleVideoTranscoderProbeResult {
  status: GoogleVideoTranscoderProbeStatus;
  reachable: boolean;
  projectId: string | null;
  location: string;
  templateId: string;
  bucketName: string | null;
  checkedAt: number;
  errorCode: string | null;
  errorMessage: string | null;
}

const TRANSCODER_API_BASE_URL = 'https://transcoder.googleapis.com/v1';
const TRANSCODER_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TRANSCODER_TEMPLATE_ID =
  process.env.VIDEO_TRANSCODER_TEMPLATE_ID?.trim() || 'preset/web-hd';
const TRANSCODER_LOCATION =
  process.env.VIDEO_TRANSCODER_LOCATION?.trim() || FUNCTIONS_REGION;
const credential = applicationDefault();

function projectId(): string {
  const resolved = String(
    process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      adminApp.options.projectId ??
      ''
  ).trim();

  if (!resolved) {
    throw new Error(
      'Projeto Google Cloud não identificado para transcodificação.'
    );
  }

  return resolved;
}

function parentName(): string {
  return `projects/${projectId()}/locations/${TRANSCODER_LOCATION}`;
}

function normalizeJobName(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  return /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/.test(normalized)
    ? normalized
    : null;
}

function normalizeProcessingVersion(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();

  return /^[a-z0-9_-]{1,63}$/.test(normalized) ? normalized : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

async function authorizationHeader(): Promise<string> {
  assertExternalVideoEgressAllowed();
  const accessToken = await credential.getAccessToken();
  const token = String(accessToken.access_token ?? '').trim();

  if (!token) {
    throw new Error('Token de acesso do Transcoder não foi obtido.');
  }

  return `Bearer ${token}`;
}

function outputUri(outputPrefix: string): string {
  const bucketName = storage.bucket().name;
  const normalizedPrefix = String(outputPrefix ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!bucketName || !normalizedPrefix) {
    throw new Error('Destino de processamento de vídeo inválido.');
  }

  return `gs://${bucketName}/${normalizedPrefix}/`;
}

function inputUri(sourceStoragePath: string): string {
  const bucketName = storage.bucket().name;
  const normalizedPath = String(sourceStoragePath ?? '')
    .trim()
    .replace(/^\/+/, '');

  if (!bucketName || !normalizedPath) {
    throw new Error('Origem de processamento de vídeo inválida.');
  }

  return `gs://${bucketName}/${normalizedPath}`;
}

async function readPersistedVideoEditSnapshot(
  job: VideoProcessingJob
): Promise<PersistedVideoEditSnapshot> {
  const snapshot = await db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .doc(buildVideoProcessingJobId(job.ownerUid, job.videoId))
    .get();
  const raw = snapshot.exists ? snapshot.data() ?? {} : {};
  const sourceDurationMs = normalizePositiveInteger(
    raw['sourceDurationMs'] ?? job.sourceDurationMs
  );
  const recipe = normalizeVideoEditRecipe(
    raw['editRecipe'] ?? job.editRecipe,
    sourceDurationMs
  );

  return { recipe, sourceDurationMs };
}

export async function probeGoogleVideoTranscoder(): Promise<GoogleVideoTranscoderProbeResult> {
  const checkedAt = Date.now();
  let resolvedProjectId: string | null = null;
  let bucketName: string | null = null;

  try {
    resolvedProjectId = projectId();
    bucketName = String(storage.bucket().name ?? '').trim() || null;
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    return {
      status: 'UNAVAILABLE',
      reachable: false,
      projectId: resolvedProjectId,
      location: TRANSCODER_LOCATION,
      templateId: TRANSCODER_TEMPLATE_ID,
      bucketName,
      checkedAt,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    };
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return {
      status: 'EMULATOR_SKIPPED',
      reachable: false,
      projectId: resolvedProjectId,
      location: TRANSCODER_LOCATION,
      templateId: TRANSCODER_TEMPLATE_ID,
      bucketName,
      checkedAt,
      errorCode: null,
      errorMessage:
        'A verificação externa foi ignorada no Emulator para evitar acesso ao projeto real.',
    };
  }

  try {
    const authorization = await authorizationHeader();

    await axios.get<GoogleTranscoderListJobsResponse>(
      `${TRANSCODER_API_BASE_URL}/${parentName()}/jobs`,
      {
        headers: { Authorization: authorization },
        params: { pageSize: 1 },
        timeout: 15_000,
      }
    );

    return {
      status: 'READY',
      reachable: true,
      projectId: resolvedProjectId,
      location: TRANSCODER_LOCATION,
      templateId: TRANSCODER_TEMPLATE_ID,
      bucketName,
      checkedAt,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    return {
      status: 'UNAVAILABLE',
      reachable: false,
      projectId: resolvedProjectId,
      location: TRANSCODER_LOCATION,
      templateId: TRANSCODER_TEMPLATE_ID,
      bucketName,
      checkedAt,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    };
  }
}

export async function submitGoogleVideoTranscoderJob(
  job: VideoProcessingJob,
  confirmBeforePost: () => Promise<boolean>
): Promise<GoogleTranscoderJobSnapshot | null> {
  const processingVersion = normalizeProcessingVersion(job.processingVersion);

  if (!processingVersion) {
    throw new Error('Versão do processamento inválida para o Transcoder.');
  }
  // Do not enable immutable mode until the provider URI and generation-aware
  // lifecycle cleanup are both integrated. Never POST the mutable original.
  if (videoSourceProbeCaptureEnabled() && job.sourceGeneration) {
    throw new Error('IMMUTABLE_TRANSCODER_POST_NOT_ENABLED');
  }

  const parent = parentName();
  const authorization = await authorizationHeader();
  const destinationUri = outputUri(job.outputPrefix);
  const editSnapshot = await readPersistedVideoEditSnapshot(job);
  const preparedSource = await prepareVideoSourceForTranscoder(
    job,
    editSnapshot.recipe
  );
  const sourceUri = inputUri(preparedSource.sourceStoragePath);
  const configInput = {
    inputUri: sourceUri,
    outputUri: destinationUri,
    recipe: preparedSource.recipe,
    sourceDurationMs: editSnapshot.sourceDurationMs,
  };
  const editedConfig = buildEditedTranscoderJobConfig(configInput);
  const neutralConfig = editedConfig ? null : buildNeutralSingleMp4Config(configInput);
  const selectedConfig = editedConfig ?? neutralConfig;
  const response = await submitAfterTranscoderPostGuard(
    confirmBeforePost,
    () => axios.post<GoogleTranscoderJobResponse>(
      `${TRANSCODER_API_BASE_URL}/${parent}/jobs`,
      {
        ...(selectedConfig
          ? { config: selectedConfig }
          : {
            inputUri: sourceUri,
            outputUri: destinationUri,
            templateId: TRANSCODER_TEMPLATE_ID,
          }),
        ttlAfterCompletionDays: 7,
        labels: {
          source: 'entretenimento',
          media: 'profile-video',
          processing_version: processingVersion,
          edited: editedConfig ? 'true' : 'false',
          output_profile: selectedConfig ? 'single_mp4' : 'template_fallback',
          rotated: editSnapshot.recipe.rotationDegrees !== 0 ? 'true' : 'false',
        },
      },
      {
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      }
    )
  );
  if (!response) return null;
  const name = normalizeJobName(response.data?.name);

  if (!name) {
    throw new AmbiguousTranscoderSubmissionError();
  }

  return normalizeSnapshot({
    ...response.data,
    name,
  });
}

export async function findGoogleVideoTranscoderJob(
  processingVersionValue: string
): Promise<GoogleTranscoderJobSnapshot | null> {
  const processingVersion = normalizeProcessingVersion(
    processingVersionValue
  );

  if (!processingVersion) {
    return null;
  }

  const authorization = await authorizationHeader();
  const found = await lookupUniqueTranscoderJob(
    processingVersion,
    async pageToken => {
      const response = await axios.get<GoogleTranscoderListJobsResponse>(
        `${TRANSCODER_API_BASE_URL}/${parentName()}/jobs`,
        {
          headers: { Authorization: authorization },
          params: {
            pageSize: 100,
            filter: `labels.processing_version="${processingVersion}"`,
            ...(pageToken ? { pageToken } : {}),
          },
          timeout: 30_000,
        }
      );
      return response.data;
    }
  );

  return found ? normalizeSnapshot(found) : null;
}

export async function getGoogleVideoTranscoderJob(
  externalJobName: string
): Promise<GoogleTranscoderJobSnapshot> {
  const name = normalizeJobName(externalJobName);

  if (!name) {
    throw new Error('Identificador do job de transcodificação inválido.');
  }

  const authorization = await authorizationHeader();
  const response = await axios.get<GoogleTranscoderJobResponse>(
    `${TRANSCODER_API_BASE_URL}/${name}`,
    {
      headers: { Authorization: authorization },
      timeout: 30_000,
    }
  );

  return normalizeSnapshot({
    ...response.data,
    name,
  });
}

export async function deleteGoogleVideoTranscoderJob(
  externalJobName: string
): Promise<void> {
  const name = normalizeJobName(externalJobName);
  if (!name) {
    throw new Error('Identificador do job de transcodificação inválido.');
  }

  const authorization = await authorizationHeader();
  await deleteVideoTranscoderJobWithTransport(name, (validatedName) =>
    axios.delete(`${TRANSCODER_API_BASE_URL}/${validatedName}`, {
      headers: { Authorization: authorization },
      timeout: 30_000,
    })
  );
}

export function normalizeGoogleTranscoderError(
  error: unknown
): NormalizedTranscoderError {
  if (error instanceof AmbiguousTranscoderSubmissionError) {
    return {
      code: 'TRANSCODER_SUBMISSION_UNCONFIRMED',
      message: error.message,
      retryable: true,
    };
  }

  if (axios.isAxiosError(error)) {
    const statusCode = Number(error.response?.status ?? 0);
    const responseData = error.response?.data as {
      error?: GoogleTranscoderErrorStatus;
    } | undefined;
    const providerStatus = String(responseData?.error?.status ?? '').trim();
    const providerMessage = String(
      responseData?.error?.message ?? error.message ?? 'Falha no Transcoder.'
    )
      .trim()
      .slice(0, 500);
    const retryable =
      statusCode === 0 ||
      statusCode === 408 ||
      statusCode === 429 ||
      statusCode >= 500;

    return {
      code: providerStatus || `HTTP_${statusCode || 'UNKNOWN'}`,
      message: providerMessage || 'Falha no Transcoder.',
      retryable,
    };
  }

  const message = error instanceof Error
    ? error.message
    : String(error ?? 'Falha desconhecida no Transcoder.');

  return {
    code: 'TRANSCODER_CLIENT_ERROR',
    message: message.slice(0, 500),
    retryable: false,
  };
}

function resolveSnapshotErrorCode(
  error: GoogleTranscoderErrorStatus | null | undefined
): string | null {
  if (error?.status) {
    return String(error.status).slice(0, 120);
  }

  if (error?.code !== undefined) {
    return String(error.code).slice(0, 120);
  }

  return null;
}

function normalizeSnapshot(
  response: GoogleTranscoderJobResponse
): GoogleTranscoderJobSnapshot {
  const name = normalizeJobName(response.name);

  if (!name) {
    throw new Error('Resposta inválida do job de transcodificação.');
  }

  return {
    name,
    state: String(response.state ?? 'PROCESSING_STATE_UNSPECIFIED')
      .trim()
      .toUpperCase(),
    errorCode: resolveSnapshotErrorCode(response.error),
    errorMessage: response.error?.message
      ? String(response.error.message).slice(0, 500)
      : null,
  };
}

export const GOOGLE_VIDEO_TRANSCODER_CONFIGURATION = {
  location: TRANSCODER_LOCATION,
  templateId: TRANSCODER_TEMPLATE_ID,
  scope: TRANSCODER_SCOPE,
} as const;
