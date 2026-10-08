import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { VideoLibraryService } from './video-library.service';

interface AccessItem {
  videoId: string;
  url: string | null;
  posterUrl: string | null;
  playbackPath: string | null;
  posterPath: string | null;
  expiresAt: number;
}

type Callable = (req: {
  ownerUid: string;
  videoIds: string[];
  mode: 'PREVIEW' | 'PLAYBACK';
}) => Promise<{ data: { items: AccessItem[] } }>;

function item(revision = 1): IVideoItem {
  return {
    id: 'video-1',
    ownerUid: 'owner-a',
    url: '',
    path: null,
    thumbnailUrl: null,
    status: 'ready',
    createdAt: 1,
    updatedAt: revision,
  };
}

function posterResponse(): { data: { items: AccessItem[] } } {
  return {
    data: {
      items: [{
        videoId: 'video-1',
        url: null,
        posterUrl: 'https://storage.example.test/poster',
        playbackPath: null,
        posterPath: 'users/owner-a/uploads/video-posters/video-1/poster.jpg',
        expiresAt: Date.now() + 10 * 60_000,
      }],
    },
  };
}

function setup() {
  const uid$ = new BehaviorSubject<string | null>('owner-a');
  const mediaError = { reportSilently: vi.fn(), reportReason: vi.fn(), report: vi.fn() };

  TestBed.configureTestingModule({
    providers: [
      VideoLibraryService,
      { provide: Firestore, useValue: {} },
      { provide: Functions, useValue: {} },
      { provide: FirestoreContextService, useValue: {} },
      { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
      { provide: MediaApplicationErrorService, useValue: mediaError },
      { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
    ],
  });
  const service = TestBed.inject(VideoLibraryService);
  const internal = service as unknown as {
    privateVideoAccessCallable: Callable;
  };
  return { service, internal, uid$, mediaError };
}

describe('VideoLibraryService / preview privado sob demanda', () => {
  it('cacheia capas válidas por revisão, sem assinar playback repetidamente', async () => {
    const { service, internal } = setup();
    const callable = vi.fn(async () => posterResponse());
    internal.privateVideoAccessCallable = callable;

    const first = await firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()]));
    const second = await firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()]));

    expect(first[0]?.thumbnailUrl).toBe('https://storage.example.test/poster');
    expect(first[0]?.url).toBe('');
    expect(second[0]?.thumbnailUrl).toBe(first[0]?.thumbnailUrl);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith({
      ownerUid: 'owner-a', videoIds: ['video-1'], mode: 'PREVIEW',
    });

    await firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item(2)]));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('compartilha acesso a poster com requisições simultâneas', async () => {
    const { service, internal } = setup();
    let resolveCall!: (value: { data: { items: AccessItem[] } }) => void;
    const callable = vi.fn(() => new Promise<{ data: { items: AccessItem[] } }>((resolve) => {
      resolveCall = resolve;
    }));
    internal.privateVideoAccessCallable = callable;

    const a = firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()]));
    const b = firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()]));
    expect(callable).toHaveBeenCalledTimes(1);

    resolveCall(posterResponse());
    const [first, second] = await Promise.all([a, b]);
    expect(first[0]?.thumbnailUrl).toBe(second[0]?.thumbnailUrl);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('descarta resposta tardia após logout→login da mesma conta', async () => {
    const { service, internal, uid$ } = setup();
    let resolveCall!: (value: { data: { items: AccessItem[] } }) => void;
    const callable = vi.fn()
      .mockImplementationOnce(() => new Promise<{ data: { items: AccessItem[] } }>((resolve) => {
        resolveCall = resolve;
      }))
      .mockImplementation(async () => posterResponse());
    internal.privateVideoAccessCallable = callable;

    const oldRequest = firstValueFrom(
      service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()])
    );

    uid$.next(null);
    uid$.next('owner-a');
    resolveCall(posterResponse());
    const stale = await oldRequest;

    expect(stale[0]?.thumbnailUrl).toBeNull();
    expect(stale[0]?.url).toBe('');

    await firstValueFrom(service.hydrateOwnedVideoPreviewAccess$('owner-a', [item()]));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('só libera playback quando chamado explicitamente', async () => {
    const { service, internal } = setup();
    const callable = vi.fn(async () => ({
      data: {
        items: [{
          ...posterResponse().data.items[0],
          url: 'https://storage.example.test/video',
          playbackPath: 'users/owner-a/processed/videos/video-1/final.mp4',
        }],
      },
    }));
    internal.privateVideoAccessCallable = callable;

    const playback = await firstValueFrom(
      service.hydrateOwnedVideoAccess$('owner-a', [item()])
    );
    expect(callable).toHaveBeenCalledWith({
      ownerUid: 'owner-a', videoIds: ['video-1'], mode: 'PLAYBACK',
    });
    expect(playback[0]?.url).toBe('https://storage.example.test/video');
  });
});
