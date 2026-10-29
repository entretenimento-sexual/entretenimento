import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareAuthorizedVideoDocuments } from './get-authorized-video-owner-page.handler';

describe('authorized video profile page ordering', () => {
  it('preserva orderIndex, data decrescente e desempate determinístico de ID', () => {
    const items = [
      { id: 'video-a', orderIndex: 2, publishedAt: 100 },
      { id: 'video-b', orderIndex: 0, publishedAt: 50 },
      { id: 'video-c', orderIndex: 0, publishedAt: 90 },
      { id: 'video-d', orderIndex: 0, publishedAt: 90 },
    ];
    assert.deepEqual(
      [...items].sort(compareAuthorizedVideoDocuments).map((item) => item.id),
      ['video-d', 'video-c', 'video-b', 'video-a']
    );
    assert.deepEqual(items.map((item) => item.id),
      ['video-a', 'video-b', 'video-c', 'video-d']);
  });
});
