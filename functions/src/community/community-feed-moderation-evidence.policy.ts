// -----------------------------------------------------------------------------
// COMMUNITY FEED MODERATION EVIDENCE POLICY
// -----------------------------------------------------------------------------
// A mídia publicada de um post denunciado só pode ser liberada quando não existe
// denúncia não terminal/desconhecida e o hold transacional do post não exige
// retenção. Estados desconhecidos permanecem fail closed.
// -----------------------------------------------------------------------------

export function isBlockingCommunityFeedModerationReportStatus(
  value: unknown
): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized !== 'resolved' && normalized !== 'rejected';
}

/**
 * Compatibilidade com posts anteriores ao campo de hold:
 * - campo ausente/null: a leitura dos reports decide;
 * - booleano: `true` sempre retém, `false` ainda respeita reports legados;
 * - qualquer outro valor: estado inconsistente, falha fechada (`null`).
 */
export function resolveCommunityFeedPostMediaRetention(
  holdValue: unknown,
  hasBlockingReport: boolean
): boolean | null {
  if (holdValue === undefined || holdValue === null) {
    return hasBlockingReport;
  }
  if (typeof holdValue !== 'boolean') {
    return null;
  }
  return holdValue || hasBlockingReport;
}
