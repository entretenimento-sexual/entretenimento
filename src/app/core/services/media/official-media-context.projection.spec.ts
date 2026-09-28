import { describe, expect, it } from 'vitest';

import {
  normalizeOfficialMediaContextProjection,
} from './official-media-context.projection';

describe('official-media-context.projection', () => {
  it('aceita somente a projeção oficial completa', () => {
    expect(
      normalizeOfficialMediaContextProjection({
        identity: { verified: true, type: 'profile' },
        association: { verified: true },
        target: { type: 'profile', id: 'profile-1' },
      })
    ).toEqual({
      identity: { verified: true, type: 'profile' },
      association: { verified: true },
      target: { type: 'profile', id: 'profile-1' },
    });
  });

  it('falha fechado para projeção parcial ou adulterada', () => {
    for (const value of [
      null,
      {},
      {
        identity: { verified: false, type: 'profile' },
        association: { verified: true },
        target: { type: 'profile', id: 'profile-1' },
      },
      {
        identity: { verified: true, type: 'profile' },
        association: { verified: false },
        target: { type: 'profile', id: 'profile-1' },
      },
      {
        identity: { verified: true, type: 'profile' },
        association: { verified: true },
        target: { type: 'venue', id: 'venue-1' },
      },
    ]) {
      expect(normalizeOfficialMediaContextProjection(value)).toBeNull();
    }
  });
});
