import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  cleanupCancelledVideoProcessingRecoveryBatch,
  reconcileVideoProcessingRecoveryBatch,
  submitQueuedVideoProcessingRecoveryBatch,
} from './video-processing-core.service';

const SCHEDULE_TIME_ZONE = 'America/Sao_Paulo';
const RECOVERY_SCHEDULE = 'every 60 minutes';

/**
 * Rede de segurança para jobs que não receberam ou não conseguiram criar a task.
 * O caminho normal de produção é orientado a eventos em
 * `video-processing-task.handler.ts`.
 */
export const submitQueuedVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: RECOVERY_SCHEDULE,
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  submitQueuedVideoProcessingRecoveryBatch
);

/**
 * Reconciliação excepcional. Não é mais o mecanismo normal de acompanhamento
 * do Google Transcoder.
 */
export const reconcileVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: RECOVERY_SCHEDULE,
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  reconcileVideoProcessingRecoveryBatch
);

/**
 * Limpeza excepcional de cancelamentos que não foram concluídos pela task.
 */
export const cleanupCancelledVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: RECOVERY_SCHEDULE,
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  cleanupCancelledVideoProcessingRecoveryBatch
);
