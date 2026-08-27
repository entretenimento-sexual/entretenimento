import { TestBed } from '@angular/core/testing';
import { EffectsModule } from '@ngrx/effects';
import { Store, StoreModule } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { take } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import { MEDIA_ROUTES } from './media.routes';
import { ProfileVideoLibraryFacade } from './videos/state/profile-video-library.facade';
import { profileVideoLibraryFeature } from './videos/state/profile-video-library.reducer';

describe('MEDIA_ROUTES NgRx integration', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('registers the lazy video feature over the NgModule root store', async () => {
    const videosRoute = MEDIA_ROUTES.find((route) => route.path === 'videos');

    expect(videosRoute?.providers).toBeTruthy();

    TestBed.configureTestingModule({
      imports: [StoreModule.forRoot({}), EffectsModule.forRoot([])],
      providers: [
        ...(videosRoute?.providers ?? []),
        {
          provide: VideoLibraryService,
          useValue: {
            watchOwnedVideoMetadata$: vi.fn(() => of([])),
            hydrateOwnedVideoPreviewAccess$: vi.fn(
              (_ownerUid: string, videos: unknown[]) => of(videos)
            ),
          },
        },
        {
          provide: VideoPublicationService,
          useValue: {
            watchOwnVideoPublications$: vi.fn(() => of([])),
            deleteProfileVideo$: vi.fn(() =>
              of({ deleted: true, cleanupPending: false })
            ),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    });

    const store = TestBed.inject(Store);
    const facade = TestBed.inject(ProfileVideoLibraryFacade);
    const initialStatus = await firstValueFrom(
      store.select(profileVideoLibraryFeature.selectStatus).pipe(take(1))
    );

    expect(facade).toBeTruthy();
    expect(initialStatus).toBe('idle');
  });
});
