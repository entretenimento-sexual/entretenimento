import axios from 'axios';
import { applicationDefault } from 'firebase-admin/app';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { adminApp, storage } from '../../firebaseApp';
import type { VideoProcessingJob } from './video-processing-job';

interface GoogleTranscoderErrorStatus {
  code?: number;
  message?: string;
  status?: string;
}

interface GoogleTranscoderJobResponse {
  name?: string;
  state?: string;
  error?: GoogleTranscoderErrorStatus | null;
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
    throw new Error('Projeto Google Cloud não identificado para transcodificação.');
  }

  return resolved;
}

function normalizeJobName(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  return /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/.test(normalized)
    ? normalized
    : null;
}

async function authorizationHeader(): Promise<string> {
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

export async function submitGoogleVideoTranscoderJob(
  job: VideoProcessingJob
): Promise<GoogleTranscoderJobSnapshot> {
  const parent = `projects/${projectId()}/locations/${TRANSCODER_LOCATION}`;
  const authorization = await authorizationHeader();
  const response = await axios.post<GoogleTranscoderJobResponse>(
    `${TRANSCODER_API_BASE_URL}/${parent}/jobs`,
    {
      inputUri: inputUri(job.sourceStoragePath),
      outputUri: outputUri(job.outputPrefix),
      templateId: TRANSCODER_TEMPLATE_ID,
    },
    {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  );
  const name = normalizeJobName(response.data?.name);

  if (!name) {
    throw new Error('O Transcoder não retornou um identificador de job válido.');
  }

  return normalizeSnapshot({
    ...response.data,
    name,
  });
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
    return;
  }

  const authorization = await authorizationHeader();

  try {
    await axios.delete(`${TRANSCODER_API_BASE_URL}/${name}`, {
      headers: { Authorization: authorization },
      timeout: 30_000,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return;
    }

    throw error;
  }
}

export function normalizeGoogleTranscoderError(
  error: unknown
): NormalizedTranscoderError {
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
    errorCode: response.error?.status
      ? String(response.error.status).slice(0, 120)
      : response.error?.code !== undefined
        ? String(response.error.code).slice(0, 120)
        : null,
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
