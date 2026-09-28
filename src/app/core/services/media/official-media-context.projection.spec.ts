import { describe, expect, it } from 'vitest';

import {
  normalizeOfficialMediaContextProjection,
} from './official-media-context.projection';

describe('official-media-context.projection', () => {
  it('aceita projeções oficiais para todos os targets canônicos', () => {
    const contexts = [
      ['profile', 'profile-1'],
      ['organization', 'organization-1'],
      ['venue', 'venue-1'],
      ['event', 'event-1'],
    ].map(([type, id]) => ({
      identity: { verified: true, type },
      association: { verified: true },
      target: { type, id },
    }));

    expect(
      normalizeOfficialMediaContextProjection({ contexts })
    ).toEqual({ contexts });
  });

  it('normaliza o formato legado de profile para contexts[]', () => {
    expect(
      normalizeOfficialMediaContextProjection({
        identity: { verified: true, type: 'profile' },
        association: { verified: true },
        target: { type: 'profile', id: 'profile-1' },
      })
    ).toEqual({
      contexts: [{
        identity: { verified: true, type: 'profile' },
        association: { verified: true },
        target: { type: 'profile', id: 'profile-1' },
      }],
    });
  });

  it('falha fechado para projeção parcial, adulterada ou com tipos divergentes', () => {
    for (const value of [
      null,
      {},
      { contexts: [] },
      {
        contexts: [{
          identity: { verified: false, type: 'profile' },
          association: { verified: true },
          target: { type: 'profile', id: 'profile-1' },
        }],
      },
      {
        contexts: [{
          identity: { verified: true, type: 'profile' },
          association: { verified: false },
          target: { type: 'profile', id: 'profile-1' },
        }],
      },
      {
        contexts: [{
          identity: { verified: true, type: 'profile' },
          association: { verified: true },
          target: { type: 'venue', id: 'venue-1' },
        }],
      },
      {
        contexts: [{
          identity: { verified: true, type: 'unknown' },
          association: { verified: true },
          target: { type: 'unknown', id: 'x' },
        }],
      },
    ]) {
      expect(normalizeOfficialMediaContextProjection(value)).toBeNull();
    }
  });
});
