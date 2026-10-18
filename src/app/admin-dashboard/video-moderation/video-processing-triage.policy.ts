import type { IAdminVideoProcessingStatus } from
  'src/app/core/services/moderation/admin-video-moderation.service';

/**
 * Diagnostic-only triage over data already returned by the admin callable.
 * No automatic recovery, mutation, provider call or additional Firestore read.
 */
export type VideoOperationsPriority =
  'ACTION_REQUIRED' | 'VERIFY' | 'NO_ALERTS_OBSERVED' | 'EMULATOR';

export interface VideoOperationsTriage {
  priority: VideoOperationsPriority;
  label: string;
  findings: string[];
}

export function assessVideoProcessingOperations(
  status: IAdminVideoProcessingStatus
): VideoOperationsTriage {
  const action: string[] = [];
  const verify: string[] = [];

  if (status.provider.status === 'UNAVAILABLE') {
    action.push('Transcoder indisponível: conferir API, projeto, região e permissões.');
  }
  if (status.queue.staleSampledJobs > 0) {
    action.push('Há jobs possivelmente atrasados na amostra; conferir a fila de recuperação.');
  }
  if (status.queue.cancellation?.overdue24h) {
    action.push('Há cancelamentos vencidos há mais de 24 horas na amostra; investigar sem excluir arquivos.');
  }
  if (status.queue.cancellation?.missingOrInvalidDue) {
    action.push('Há cancelamentos com agendamento ausente ou inválido na amostra.');
  }

  for (const scheduler of status.schedulers) {
    const name = scheduler.scheduler === 'submitQueuedVideoProcessing'
      ? 'Envio de vídeos'
      : scheduler.scheduler === 'reconcileVideoProcessing'
        ? 'Reconciliação'
        : 'Cancelamentos';
    if (scheduler.executionHealth === 'FAILED') {
      action.push(`${name}: última execução recente falhou; conferir Cloud Logging.`);
    } else if (scheduler.jobsHealth === 'ATTENTION') {
      action.push(`${name}: os resultados dos jobs exigem atenção.`);
    } else if (scheduler.executionHealth === 'UNVERIFIED' ||
        scheduler.jobsHealth === 'UNVERIFIED' ||
        scheduler.evidenceConfidence !== 'RECENT' ||
        scheduler.historyCoverage !== 'BEST_EFFORT') {
      verify.push(`${name}: evidência incompleta ou não verificada; conferir Cloud Logging e Cloud Scheduler.`);
    }
    if (scheduler.recentIncident) {
      verify.push(`${name}: existe um incidente recente no histórico limitado; investigar a origem.`);
    }
  }

  if (status.queue.sampleCapped || status.queue.cancellation?.samplePartial) {
    verify.push('A amostra de jobs é parcial; os indicadores não descrevem toda a fila.');
  }
  if (status.queue.counts.FAILED > 0) {
    verify.push('Existem jobs em estado terminal FAILED; verificar histórico, sem presumir falha atual.');
  }

  if (action.length) return {
    priority: 'ACTION_REQUIRED', label: 'Ação operacional necessária',
    findings: [...action, ...verify].slice(0, 10),
  };
  if (verify.length) return {
    priority: 'VERIFY', label: 'Verificação operacional necessária',
    findings: verify.slice(0, 10),
  };
  if (status.provider.status === 'EMULATOR_SKIPPED') return {
    priority: 'EMULATOR', label: 'Verificação externa não executada no Emulator',
    findings: ['O Emulator não consulta a API real do Transcoder.'],
  };
  return {
    priority: 'NO_ALERTS_OBSERVED', label: 'Sem alertas nos dados consultados',
    findings: ['Resultado limitado à amostra e às evidências recebidas; não certifica o pipeline completo.'],
  };
}
