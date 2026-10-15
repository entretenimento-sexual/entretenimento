import { describe, expect, it } from 'vitest';
import { resolvePublicMediaAvailability } from './public-media-availability.policy';

describe('public media availability projection', () => {
  it('accepts only explicit versioned booleans', () => {
    expect(resolvePublicMediaAvailability({ version: 1, available: true })).toBe(true);
    expect(resolvePublicMediaAvailability({ version: 1, available: false })).toBe(false);
  });
  it('never interprets missing or legacy state as permission', () => {
    for (const data of [
      null, undefined, {}, { available: true },
      { version: 2, available: true },
      { version: 1, available: 'true' },
      { version: 1, available: 1 },
    ]) {
      expect(resolvePublicMediaAvailability(data)).toBeNull();
    }
  });
});
