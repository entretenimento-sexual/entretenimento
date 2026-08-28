import {
  buildMediaReportSafetyState,
  shouldQuarantineMediaAfterReport,
  type MediaReportCounterEvent,
  type MediaReportCounterInput,
  type MediaReportSafetyReason,
  type MediaReportSafetyState,
} from './media-report-safety';

/**
 * Compatibilidade temporária com os nomes públicos já usados por vídeo.
 *
 * SUPRESSÃO EXPLÍCITA:
 * a implementação duplicada da política de quarentena foi removida daqui.
 * Foto e vídeo passam a consumir a mesma regra em media-report-safety.ts,
 * evitando limiares ou razões graves divergentes entre tipos de mídia.
 */
export type VideoReportCounterInput = MediaReportCounterInput;
export type VideoReportCounterEvent = MediaReportCounterEvent;
export type VideoReportSafetyReason = MediaReportSafetyReason;
export type VideoReportSafetyState = MediaReportSafetyState;

export const buildVideoReportSafetyState = buildMediaReportSafetyState;
export const shouldQuarantineVideoAfterReport =
  shouldQuarantineMediaAfterReport;
