import { describe, expect, it } from 'vitest';
import type { IProfileVideoViewItem } from '../state/profile-video-library.models';
import {
  canPlayPublishedVideo,
  filterProfileVideoGallery,
} from './profile-video-gallery.policy';

const entry = (
  id: string,
  moderationStatus: 'APPROVED' | 'PENDING_REVIEW' = 'APPROVED',
  visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC'
): IProfileVideoViewItem => ({
  video: { id, status: 'ready' },
  publication: { isPublished: true, moderationStatus, visibility },
} as unknown as IProfileVideoViewItem);

describe('owner video gallery filters', () => {
  const ready = entry('ready');
  const pending = entry('pending', 'PENDING_REVIEW');
  const privateItem = entry('restricted', 'APPROVED', 'PRIVATE');
  const items = [ready, pending, privateItem];

  it('preserves the chronological order received from the canonical library', () => {
    expect(filterProfileVideoGallery(items, 'all')).toEqual(items);
    expect(filterProfileVideoGallery(items, 'published')).toEqual([ready]);
    expect(filterProfileVideoGallery(items, 'not-published'))
      .toEqual([pending, privateItem]);
  });

  it('does not treat a pending review or restricted visibility as playable', () => {
    expect(canPlayPublishedVideo(ready)).toBe(true);
    expect(canPlayPublishedVideo(pending)).toBe(false);
    expect(canPlayPublishedVideo(privateItem)).toBe(false);
  });
});
