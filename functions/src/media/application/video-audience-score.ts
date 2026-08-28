import {
  normalizeMediaScore,
} from './media-engagement-score';
import {
  calculateMediaViewScore,
  type MediaViewScoreInput,
} from './media-audience-score';

export type VideoViewScoreInput = MediaViewScoreInput;

/**
 * Alias de compatibilidade para o sinal bruto de audiência qualificada.
 *
 * As visualizações usadas aqui já passaram pela qualificação de playback do
 * backend. A fórmula canônica é compartilhada com outras mídias; este nome é
 * mantido para não quebrar os consumidores existentes do fluxo de vídeo.
 */
export function calculateVideoViewScore(input: VideoViewScoreInput): number {
  return calculateMediaViewScore(input);
}

/**
 * Converte o contador bruto em faixa 0..100 com retorno decrescente.
 * Isso permite que audiência qualificada participe do ranking sem deixar um
 * vídeo antigo, apenas por volume acumulado, dominar indefinidamente.
 */
export function normalizeVideoAudienceScore(viewScore: unknown): number {
  const safeViewScore = normalizeNonNegativeNumber(viewScore);

  if (safeViewScore <= 0) {
    return 0;
  }

  return normalizeMediaScore(
    Math.round(Math.log1p(safeViewScore) * 12)
  );
}

function normalizeNonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}
