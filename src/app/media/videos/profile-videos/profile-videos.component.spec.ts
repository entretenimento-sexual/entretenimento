import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaPolicyService } from 'src/app/core/services/media/media-policy.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoMetadataPreparationService } from 'src/app/core/services/media/video-metadata-preparation.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import { VideoUploadFlowService } from 'src/app/core/services/media/video-upload-flow.service';
import { ProfileVideosComponent } from './profile-videos.component';

const OWNER_UID = 'owner-1';

const VIDEO: IVideoItem = {
  id: 'video-1',
  ownerUid: OWNER_UID,
  url: 'https://example.test/video.mp4',
  fileName: 'video-de-apresentacao.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1_024,
  durationMs: 30_000,
  thumbnailUrl: 'https://example.test/poster.webp',
  status: 'ready',
  createdAt: 1,
};

describe('ProfileVideosComponent', () => {
  let fixture: ComponentFixture<ProfileVideosComponent>;
  let videosSubject: BehaviorSubject<IVideoItem[]>;
  let policySubject: BehaviorSubject<
    { decision: 'ALLOW' } | { decision: 'DENY'; reason: 'EMAIL_NOT_VERIFIED' }
  >;

  beforeEach(async () => {
    videosSubject = new BehaviorSubject<IVideoItem[]>([VIDEO]);
    policySubject = new BehaviorSubject<{ decision: 'ALLOW' }>({
      decision: 'ALLOW',
    });

    await TestBed.configureTestingModule({
      imports: [ProfileVideosComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: OWNER_UID })),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({
              uid: OWNER_UID,
              emailVerified: true,
              profileCompleted: true,
              interactionBlocked: false,
            }),
          },
        },
        {
          provide: VideoLibraryService,
          useValue: {
            watchPrivateVideos$: vi.fn(() => videosSubject.asObservable()),
          },
        },
        {
          provide: VideoPublicationService,
          useValue: {
            watchOwnVideoPublications$: vi.fn(() => of([])),
          },
        },
        {
          provide: VideoUploadFlowService,
          useValue: {},
        },
        {
          provide: VideoMetadataPreparationService,
          useValue: {},
        },
        {
          provide: MediaPolicyService,
          useValue: {
            canUploadProfileVideosForViewer$: vi.fn(() =>
              policySubject.asObservable()
            ),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileVideosComponent);
    fixture.detectChanges();
  });

  it('prioriza a biblioteca e mantém o compositor de upload fechado inicialmente', () => {
    const element = fixture.nativeElement as HTMLElement;
    const disclosure = element.querySelector(
      '.profile-videos__upload-disclosure'
    ) as HTMLDetailsElement;

    expect(element.querySelector('h1')?.textContent).toContain('Meus vídeos');
    expect(element.querySelector('.profile-videos__count')?.textContent).toContain(
      '1'
    );
    expect(disclosure).toBeTruthy();
    expect(disclosure.open).toBe(false);
    expect(
      disclosure.querySelector('.profile-videos__upload-trigger')?.textContent
    ).toContain('Adicionar vídeo');
  });

  it('mantém o aviso de elegibilidade dentro do fluxo de upload sem ocupar o topo', () => {
    policySubject.next({
      decision: 'DENY',
      reason: 'EMAIL_NOT_VERIFIED',
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const disclosure = element.querySelector(
      '.profile-videos__upload-disclosure'
    ) as HTMLDetailsElement;
    const policyState = disclosure.querySelector(
      '.profile-videos__policy-state'
    );

    expect(disclosure.open).toBe(false);
    expect(policyState?.textContent).toContain('Confirme o e-mail');
  });

  it('preserva a hierarquia padronizada do card com status sobre a mídia', () => {
    const element = fixture.nativeElement as HTMLElement;
    const card = element.querySelector('.profile-videos__card') as HTMLElement;
    const media = card.querySelector('.profile-videos__media') as HTMLElement;
    const body = card.querySelector('.profile-videos__body') as HTMLElement;

    expect(card).toBeTruthy();
    expect(media).toBeTruthy();
    expect(body).toBeTruthy();
    expect(media.querySelector('.profile-videos__publication-chip')).toBeTruthy();
    expect(
      media.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('oferece uma ação discreta para o primeiro vídeo no estado vazio', () => {
    videosSubject.next([]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const emptyState = element.querySelector(
      '.profile-videos__empty'
    ) as HTMLElement;
    const firstUploadAction = emptyState.querySelector(
      'label[for="profile-video-file"]'
    );

    expect(emptyState.textContent).toContain('Sua biblioteca ainda está vazia');
    expect(firstUploadAction?.textContent).toContain('Adicionar primeiro vídeo');
  });
});
