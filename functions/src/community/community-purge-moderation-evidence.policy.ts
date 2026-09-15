// -----------------------------------------------------------------------------
// COMMUNITY PURGE MODERATION EVIDENCE POLICY
// -----------------------------------------------------------------------------
// Classifica somente a necessidade de preservar o conteúdo-alvo durante o purge.
// Denúncias encerradas continuam preservadas em `moderation_reports`, namespace
// protegido, mas deixam de funcionar como hold implícito permanente da Comunidade.
// Qualquer estado não terminal, ausente ou desconhecido permanece fail closed.
// -----------------------------------------------------------------------------

export interface CommunityModerationEvidenceCounts {
  totalCount: unknown;
  resolvedCount: unknown;
  rejectedCount: unknown;
}

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

/**
 * `false`: toda evidência encontrada está em estado terminal conhecido.
 * `true`: existe evidência aberta/em revisão/desconhecida que deve bloquear.
 * `null`: as contagens são inconsistentes e o chamador deve falhar fechado.
 */
export function resolveCommunityModerationPurgeBlocker(
  counts: Readonly<CommunityModerationEvidenceCounts>
): boolean | null {
  const totalCount = normalizeCount(counts.totalCount);
  const resolvedCount = normalizeCount(counts.resolvedCount);
  const rejectedCount = normalizeCount(counts.rejectedCount);

  if (
    totalCount === null
    || resolvedCount === null
    || rejectedCount === null
  ) {
    return null;
  }

  const terminalCount = resolvedCount + rejectedCount;
  if (!Number.isSafeInteger(terminalCount) || terminalCount > totalCount) {
    return null;
  }

  return totalCount > terminalCount;
}
