import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from './video-metadata-preparation.service';
import { VideoUploadFlowService } from './video-upload-flow.service';

vi.mock('@angular/fire/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/fire/functions')>();
  return {
    ...actual,
    httpsCallable: vi.fn(() => vi.fn()),
  };
});

vi.mock('@angular/fire/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
  return {
    ...actual,
    collection: vi.fn(() => ({ path: 'users/owner-a/videos' })),
    doc: vi.fn(() => ({ id: 'video-1' })),
  };
});

describe('VideoUploadFlowService / lifecycle', () => {
  it('encerra upload quando a sessão muda de A para B durante preparação', () => {
    const uid$ = new BehaviorSubject<string | null>('owner-a');
    const metadata$ = new Subject<IPreparedVideoMetadata>();
    const mediaError = {
      reportSilently: vi.fn(),
    };
    const complete = vi.fn();
    const next = vi.fn();
    const error = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        VideoUploadFlowService,
        {
          provide: Auth,
          useValue: {
            currentUser: { uid: 'owner-a' },
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: uid$.asObservable(),
          },
        },
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: Storage,
          useValue: {},
        },
        {
          provide: VideoMetadataPreparationService,
          useValue: {
            prepare$: vi.fn(() => metadata$.asObservable()),
          },
        },
        {
          provide: MediaApplicationErrorService,
          useValue: mediaError,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    const service = TestBed.inject(VideoUploadFlowService);
    const file = new File(['video'], 'video.mp4', { type: 'video/mp4' });

    const subscription = service.uploadPrivateVideo$({
      ownerUid: 'owner-a',
      file,
      publication: {
        title: null,
        description: null,
        reactionsEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
      },
    }).subscribe({ next, error, complete });

    expect(next).toHaveBeenCalledWith({
      type: 'progress',
      phase: 'preparing',
      progress: 2,
    });

    uid$.next('owner-b');

    expect(complete).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(subscription.closed).toBe(true);

    metadata$.next({
      durationMs: 10_000,
      widthPixels: 1280,
      heightPixels: 720,
      posterBlob: null,
      posterMimeType: null,
      playbackReady: true,
    });
    metadata$.complete();

    expect(
      next.mock.calls.some(([event]) => event?.type === 'success')
    ).toBe(false);
    expect(mediaError.reportSilently).not.toHaveBeenCalled();
  });
});
