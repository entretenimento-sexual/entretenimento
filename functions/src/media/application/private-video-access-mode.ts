export type PrivateVideoAccessMode = 'PREVIEW' | 'PLAYBACK';

export function normalizePrivateVideoAccessMode(
  value: unknown
): PrivateVideoAccessMode {
  return String(value ?? '').trim().toUpperCase() === 'PREVIEW'
    ? 'PREVIEW'
    : 'PLAYBACK';
}

export function shouldIssuePrivateVideoPlaybackAccess(
  mode: PrivateVideoAccessMode
): boolean {
  return mode === 'PLAYBACK';
}
