/** Media errors are recovery hints, never proof of authorization. */
export type PublicVideoPlaybackFailure = 'offline' | 'expired' | 'network' | 'media';
export function classifyPublicVideoPlaybackFailure(input: {
  readonly offline: boolean;
  readonly expiresAt: number | null | undefined;
  readonly now: number;
  readonly mediaErrorCode: number | null | undefined;
}): PublicVideoPlaybackFailure {
  if (input.offline) return 'offline';
  const expiry = Number(input.expiresAt);
  if (Number.isFinite(expiry) && expiry > 0 && expiry <= input.now) {
    return 'expired';
  }
  // HTMLMediaElement.MEDIA_ERR_NETWORK. Codec/decode errors are not
  // access failures and must not automatically reissue signed URLs.
  return input.mediaErrorCode === 2 ? 'network' : 'media';
}
export function canRetryExpiringPublicVideoAccess(input: {
  readonly offline: boolean;
  readonly expiresAt: number | null | undefined;
  readonly now: number;
  readonly retriesUsed: number;
  readonly retryDelayMs: number;
}): boolean {
  const expiry = Number(input.expiresAt);
  return !input.offline && input.retriesUsed < 1 &&
    Number.isFinite(expiry) && expiry > input.now + input.retryDelayMs;
}
