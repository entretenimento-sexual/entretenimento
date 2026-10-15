import { describe, expect, it } from 'vitest';
import {
  canRetryExpiringPublicVideoAccess,
  classifyPublicVideoPlaybackFailure,
} from './public-video-playback-failure.policy';

describe('public video playback recovery classification', () => {
  it('does not refresh when offline, even if a token expired', () => {
    expect(classifyPublicVideoPlaybackFailure({
      offline: true, expiresAt: 500, now: 600, mediaErrorCode: 2,
    })).toBe('offline');
  });
  it('separates expired URL from media decoding errors', () => {
    expect(classifyPublicVideoPlaybackFailure({
      offline: false, expiresAt: 500, now: 600, mediaErrorCode: 4,
    })).toBe('expired');
  });
  it('refreshes only on media network errors, not codec/decode', () => {
    expect(classifyPublicVideoPlaybackFailure({
      offline: false, expiresAt: 900, now: 600, mediaErrorCode: 2,
    })).toBe('network');
    for (const code of [null, 1, 3, 4]) {
      expect(classifyPublicVideoPlaybackFailure({
        offline: false, expiresAt: 900, now: 600, mediaErrorCode: code,
      })).toBe('media');
    }
  });
  it('bounds automatic expiry retries and avoids expired or offline retries', () => {
    const input = {
      offline: false, expiresAt: 120000, now: 0,
      retriesUsed: 0, retryDelayMs: 15000,
    };
    expect(canRetryExpiringPublicVideoAccess(input)).toBe(true);
    expect(canRetryExpiringPublicVideoAccess({
      ...input, retriesUsed: 1,
    })).toBe(false);
    expect(canRetryExpiringPublicVideoAccess({
      ...input, offline: true,
    })).toBe(false);
    expect(canRetryExpiringPublicVideoAccess({
      ...input, expiresAt: 10000,
    })).toBe(false);
  });
});
