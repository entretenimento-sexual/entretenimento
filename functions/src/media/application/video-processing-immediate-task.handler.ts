import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { adminApp } from '../../firebaseApp';
import { submitQueuedVideoProcessing } from './video-processing.handler';

export interface ImmediateVideoProcessingTaskData {
  ownerUid?: unknown;
  videoId?: unknown;
}

export interface NormalizedImmediateVideoProcessingTaskData {
  ownerUid: string;
  videoId: string;
}

const TASK_FUNCTION_NAME = 'submitQueuedVideoProcessingTask';
const TASK_DISPATCH_DEADLINE_SECONDS = 9 * 60;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

export function normalizeImmediateVideoProcessingTaskData(
  data: ImmediateVideoProcessingTaskData | undefined
): NormalizedImmediateVideoProcessingTaskData | null {
  const ownerUid = cleanId(data?.ownerUid);
  const videoId = cleanId(data?.videoId);

  return ownerUid && videoId ? { ownerUid, videoId } : null;
}

/**
 * Adiciona o sinal de processamento ao Cloud Tasks sem transformar uma falha
 * de despacho em falha de registro. O job durável já existe no Firestore e o
 * agendamento periódico continua sendo o mecanismo de recuperação.
 *
 * Requisito operacional de deploy: Cloud Tasks API habilitada e a conta de
 * serviço das Functions com permissão para enfileirar e invocar a task.
 */
export async function enqueueImmediateVideoProcessingBestEffort(
  ownerUid: string,
  videoId: string
): Promise<boolean> {
  const payload = normalizeImmediateVideoProcessingTaskData({
    ownerUid,
    videoId,
  });

  if (!payload) {
    logger.error('[videoProcessingTask] Identificadores inválidos no despacho.');
    return false;
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return false;
  }

  try {
    const queue = getFunctions(adminApp).taskQueue<
      NormalizedImmediateVideoProcessingTaskData
    >(
      `locations/${FUNCTIONS_REGION}/functions/${TASK_FUNCTION_NAME}`
    );

    await queue.enqueue(payload, {
      dispatchDeadlineSeconds: TASK_DISPATCH_DEADLINE_SECONDS,
    });

    logger.info('[videoProcessingTask] Processamento imediato despachado.', {
      hasOwnerUid: true,
      hasVideoId: true,
    });
    return true;
  } catch (error) {
    logger.warn(
      '[videoProcessingTask] Despacho imediato falhou; recuperação mantida.',
      {
        hasOwnerUid: true,
        hasVideoId: true,
        error: error instanceof Error
          ? error.message.slice(0, 500)
          : String(error ?? 'unknown').slice(0, 500),
      }
    );
    return false;
  }
}

/**
 * Caminho de baixa latência. A rotina agendada continua ativa e executa a
 * mesma submissão transacional como reparo para tarefas perdidas ou atrasadas.
 */
export const submitQueuedVideoProcessingTask = onTaskDispatched<
  ImmediateVideoProcessingTaskData
>(
  {
    region: FUNCTIONS_REGION,
    memory: '512MiB',
    timeoutSeconds: TASK_DISPATCH_DEADLINE_SECONDS,
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 15,
      maxBackoffSeconds: 300,
      maxDoublings: 4,
    },
    rateLimits: {
      maxConcurrentDispatches: 2,
    },
  },
  async (request) => {
    const payload = normalizeImmediateVideoProcessingTaskData(request.data);

    if (!payload) {
      throw new Error('Tarefa de processamento de vídeo inválida.');
    }

    logger.info('[videoProcessingTask] Submissão imediata iniciada.', {
      hasOwnerUid: true,
      hasVideoId: true,
    });

    await submitQueuedVideoProcessing.run({
      jobName: `${TASK_FUNCTION_NAME}:${payload.videoId}`,
      scheduleTime: new Date().toISOString(),
    });
  }
);
