export type TPublicVideoAccessMode = 'PREVIEW' | 'PLAYBACK';

/**
 * Mantém PLAYBACK como padrão para compatibilidade com clientes já publicados.
 * Novas superfícies de card devem declarar PREVIEW explicitamente.
 */
export function normalizePublicVideoAccessMode(
  value: unknown
): TPublicVideoAccessMode {
  return String(value ?? '').trim().toUpperCase() === 'PREVIEW'
    ? 'PREVIEW'
    : 'PLAYBACK';
}

export function shouldIssuePublicVideoPlaybackAccess(
  mode: TPublicVideoAccessMode
): boolean {
  return mode === 'PLAYBACK';
}
