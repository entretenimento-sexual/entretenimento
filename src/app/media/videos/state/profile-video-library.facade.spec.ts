import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of, Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoLibraryService, VIDEO_OWNER_ACCESS_REFRESH_MS } from 'src/app/core/services/media/video-library.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import type { IProfileVideoStoredItem, IProfileVideoViewItem } from './profile-video-library.models';
import {
  PRIVATE_VIDEO_PREVIEW_BATCH_DELAY_MS,
  ProfileVideoLibraryFacade,
  selectNearbyPrivateVideos,
} from './profile-video-library.facade';
import { profileVideoLibraryFeature } from './profile-video-library.reducer';

function item(id: string): IProfileVideoStoredItem {
  return {
    video: {
      id, ownerUid: 'owner-a', fileName: null, mimeType: null, sizeBytes: null,
      sourceMimeType: null, sourceSizeBytes: null, durationMs: null,
      processedMimeType: null, processedSizeBytes: null, processingStage: null,
      processingErrorCode: null, processingErrorMessage: null,
      processingCompletedAt: null, status: 'ready', createdAt: 123,
      updatedAt: 123,
    },
    publication: null,
  };
}

function setup() {
  const ownerUid$ = new BehaviorSubject<string | null>(null);
  const items$ = new BehaviorSubject<IProfileVideoStoredItem[]>([]);
  const mockDocument = new EventTarget() as EventTarget & {
    visibilityState: 'visible' | 'hidden';
  };
  mockDocument.visibilityState = 'visible';

  const hydrate = vi.fn((ownerUid: string, videos: readonly { id: string; url: string }[]) =>
    of(videos.map(video => ({
      ...video, thumbnailUrl: `https://example.test/${video.id}`,
    })))
  );

  const store = {
    select: vi.fn((selector: unknown) => {
      if (selector === profileVideoLibraryFeature.selectOwnerUid) {
        return ownerUid$.asObservable();
      }
      if (selector === profileVideoLibraryFeature.selectItems) {
        return items$.asObservable();
      }
      return of(null);
    }),
    dispatch: vi.fn(),
  };

  TestBed.configureTestingModule({
    providers: [
      ProfileVideoLibraryFacade,
      { provide: Store, useValue: store },
      { provide: VideoLibraryService, useValue: {
        hydrateOwnedVideoPreviewAccess$: hydrate,
      } },
      { provide: DOCUMENT, useValue: mockDocument },
      { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
    ],
  });

  const facade = TestBed.inject(ProfileVideoLibraryFacade);
  const emissions: IProfileVideoViewItem[][] = [];
  const subscription: Subscription = facade.viewItems$.subscribe(
    (value) => emissions.push(value)
  );

  return { facade, hydrate, store, ownerUid$, items$, mockDocument, emissions, subscription };
}

function flush(): void {
  vi.advanceTimersByTime(PRIVATE_VIDEO_PREVIEW_BATCH_DELAY_MS + 3);
}

describe('ProfileVideoLibraryFacade / autorizações por viewport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('limita a seleção aos IDs próximos, nunca a cards desconhecidos', () => {
    const selection = selectNearbyPrivateVideos(
      [item('1'), item('2'), item('3')],
      new Set(['2', '99'])
    );
    expect(selection.map((entry) => entry.video.id)).toEqual(['2']);
  });

  it('não solicita capas fora da tela, agrupa entradas e preserva o restante da grade', () => {
    const { facade, hydrate, ownerUid$, items$, emissions, subscription } = setup();
    facade.watchOwner('owner-a');
    ownerUid$.next('owner-a');
    items$.next([item('1'), item('2'), item('3')]);
    flush();
    expect(hydrate).not.toHaveBeenCalled();

    facade.setPreviewNearby('1', true);
    facade.setPreviewNearby('2', true);
    flush();

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate.mock.calls[0]?.[1].map((video) => video.id)).toEqual(['1', '2']);
    expect(emissions.at(-1)?.map((entry) => [entry.video.id, entry.video.thumbnailUrl])).toEqual([
      ['1', 'https://example.test/1'],
      ['2', 'https://example.test/2'],
      ['3', null],
    ]);

    facade.setPreviewNearby('1', false);
    flush();
    expect(hydrate.mock.calls.at(-1)?.[1].map((video) => video.id)).toEqual(['2']);
    subscription.unsubscribe();
  });

  it('suspende renovação na aba oculta e reconcilia ao retornar', () => {
    const { facade, hydrate, ownerUid$, items$, mockDocument, subscription } = setup();
    facade.watchOwner('owner-a');
    ownerUid$.next('owner-a');
    items$.next([item('1')]);
    facade.setPreviewNearby('1', true);
    flush();
    expect(hydrate).toHaveBeenCalledTimes(1);

    mockDocument.visibilityState = 'hidden';
    mockDocument.dispatchEvent(new Event('visibilitychange'));
    flush();
    vi.advanceTimersByTime(VIDEO_OWNER_ACCESS_REFRESH_MS * 2);
    expect(hydrate).toHaveBeenCalledTimes(1);

    mockDocument.visibilityState = 'visible';
    mockDocument.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(hydrate).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it('limpa seleção na troca do proprietário ou parada da biblioteca', () => {
    const { facade, hydrate, ownerUid$, items$, subscription } = setup();
    facade.watchOwner('owner-a');
    ownerUid$.next('owner-a');
    items$.next([item('1')]);
    facade.setPreviewNearby('1', true);
    flush();
    expect(hydrate).toHaveBeenCalledTimes(1);

    facade.watchOwner('owner-b');
    ownerUid$.next('owner-b');
    flush();
    expect(hydrate).toHaveBeenCalledTimes(1);

    facade.stop();
    flush();
    expect(hydrate).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });
});
