import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import type {
  IPublicProfileVideoCursor,
  IPublicProfileVideoPage,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
import { resolveOwnerVideoGallerySelection$ } from './owner-video-gallery-navigation';

const item = (id: string, ownerUid = 'owner') =>
  ({ id, ownerUid, visibility: 'PUBLIC', moderationStatus: 'APPROVED' })
    as IPublicVideoItem;

const cursor = (id: string): IPublicProfileVideoCursor =>
  ({ documentId: id, orderIndex: 1, publishedAt: 100 });

const page = (items: IPublicVideoItem[], next: IPublicProfileVideoCursor | null):
IPublicProfileVideoPage => ({ items, nextCursor: next, hasMore: !!next });

describe('owner public video gallery navigation', () => {
  it('preserves the selected older video and its neighbors across pages', async () => {
    const loadPage = vi.fn((next: IPublicProfileVideoCursor | null) =>
      of(next
        ? page([item('third'), item('fourth')], null)
        : page([item('first'), item('second')], cursor('second'))
      )
    );
    const fallback = vi.fn(() => of(item('third')));
    const result = await firstValueFrom(resolveOwnerVideoGallerySelection$(
      'owner', 'third', loadPage, fallback
    ));
    expect(result?.items.map(video => video.id))
      .toEqual(['first', 'second', 'third', 'fourth']);
    expect(result?.startIndex).toBe(2);
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('deduplicates paginated items and excludes another owner or revoked video', async () => {
    const loadPage = vi.fn(() => of(page([
      item('one'), item('one'), item('foreign', 'someone-else'),
      { ...item('revoked'), moderationStatus: 'HIDDEN' } as IPublicVideoItem,
      item('target'),
    ], null)));
    const result = await firstValueFrom(resolveOwnerVideoGallerySelection$(
      'owner', 'target', loadPage, () => of(null)
    ));
    expect(result?.items.map(video => video.id)).toEqual(['one', 'target']);
    expect(result?.startIndex).toBe(1);
  });

  it('does not substitute a different video when selected is revoked', async () => {
    const fallback = vi.fn(() => of(item('other')));
    const result = await firstValueFrom(resolveOwnerVideoGallerySelection$(
      'owner', 'removed', () => of(page([item('other')], null)), fallback
    ));
    expect(result).toBeNull();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('bounds pagination to three requests then falls back to authorized ID', async () => {
    const loadPage = vi.fn((c: IPublicProfileVideoCursor | null) =>
      of(page([item(c?.documentId ?? 'first')], cursor(
        c?.documentId === 'second' ? 'third' : 'second'
      ))));
    const result = await firstValueFrom(resolveOwnerVideoGallerySelection$(
      'owner', 'target', loadPage, () => of(item('target'))
    ));
    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(result?.items.map(video => video.id)).toEqual(['target']);
    expect(result?.startIndex).toBe(0);
  });
});
