import { describe, expect, it } from 'vitest';

import { normalizePublicMediaActionIds } from './media-reactions.service';

describe('normalizePublicMediaActionIds', () => {
  it('normaliza identificadores válidos', () => {
    expect(
      normalizePublicMediaActionIds(' owner_1 ', 'photo-2', 'viewer_3')
    ).toEqual({
      ownerUid: 'owner_1',
      mediaId: 'photo-2',
      viewerUid: 'viewer_3',
    });
  });

  it.each([
    ['', 'photo-2', 'viewer-3'],
    ['owner-1', 'foto inválida', 'viewer-3'],
    ['owner-1', 'photo-2', null],
    ['owner/1', 'photo-2', 'viewer-3'],
  ])(
    'rejeita ação com identificadores inválidos',
    (ownerUid, mediaId, viewerUid) => {
      expect(
        normalizePublicMediaActionIds(ownerUid, mediaId, viewerUid)
      ).toBeNull();
    }
  );
});
