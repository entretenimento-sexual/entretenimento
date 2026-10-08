import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { VideoMetadataPreparationService } from './video-metadata-preparation.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { VideoUploadFlowService } from './video-upload-flow.service';

describe('VideoUploadFlowService / registro após troca de conta', () => {
  it('não repete a callable de A quando a sessão mudou durante backoff', async () => {
    const uid$ = new BehaviorSubject<string | null>('owner-a');
    TestBed.configureTestingModule({
      providers: [
        VideoUploadFlowService,
        { provide: Auth, useValue: { currentUser: { uid: 'owner-a' } } },
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        { provide: Storage, useValue: {} },
        { provide: VideoMetadataPreparationService, useValue: {} },
        { provide: MediaApplicationErrorService, useValue: { reportSilently: vi.fn() } },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
      ],
    });
    const service = TestBed.inject(VideoUploadFlowService);
    const internal = service as unknown as {
      registerPrivateVideoUploadCallable: (payload: unknown) => Promise<unknown>;
      registerUploadedVideo: (payload: unknown, assertActive: () => void) => Promise<unknown>;
      delay: (ms: number) => Promise<void>;
    };
    const callable = vi.fn()
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockResolvedValueOnce({ data: { videoId: 'unexpected' } });
    internal.registerPrivateVideoUploadCallable = callable;
    internal.delay = vi.fn(async () => { uid$.next('owner-b'); });
    const assertActive = () => {
      if (uid$.value !== 'owner-a') {
        throw new Error('session changed');
      }
    };

    await expect(
      internal.registerUploadedVideo({ ownerUid: 'owner-a' }, assertActive)
    ).rejects.toThrow('session changed');
    expect(callable).toHaveBeenCalledTimes(1);
  });
});
