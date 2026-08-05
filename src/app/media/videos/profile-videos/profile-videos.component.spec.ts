import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type TestPolicyResult =
  | { decision: 'ALLOW' }
  | { decision: 'DENY'; reason: 'EMAIL_NOT_VERIFIED' };

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
  let component: ProfileVideosComponent;
  let fixture: ComponentFixture<ProfileVideosComponent>;
  let videosSubject: BehaviorSubject<IVideoItem[]>;
  let policySubject: BehaviorSubject<TestPolicyResult>;
  let dialogClosedSubject: Subject<void>;
  let dialogRef: {
    close: ReturnType<typeof vi.fn>;
    afterClosed: ReturnType<typeof vi.fn>;
  };
  let dialogOpen: ReturnType<typeof vi.spyOn>;

  const queryUploadTrigger = (): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '.profile-videos__upload-trigger'
    ) as HTMLButtonElement;

  const detectComponentChanges = (): void => {
    fixture.componentRef.changeDetectorRef.detectChanges();
  };

  beforeEach(async () => {
    videosSubject = new BehaviorSubject<IVideoItem[]>([VIDEO]);
    policySubject = new BehaviorSubject<TestPolicyResult>({
      decision: 'ALLOW',
    });
    dialogClosedSubject = new Subject<void>();
    dialogRef = {
      close: vi.fn(() => {
        dialogClosedSubject.next();
        dialogClosedSubject.complete();
      }),
      afterClosed: vi.fn(() => dialogClosedSubject.asObservable()),
    };

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
    component = fixture.componentInstance;

    // O componente standalone pode resolver o MatDialog em um injector diferente
    // do injector raiz do TestBed. O spy usa a referência exata já injetada.
    const componentDialog = (
      component as unknown as { dialog: MatDialog }
    ).dialog;
    dialogOpen = vi
      .spyOn(componentDialog, 'open')
      .mockReturnValue(dialogRef as never);

    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prioriza a biblioteca sem renderizar o compositor de upload no topo', () => {
    const element = fixture.nativeElement as HTMLElement;
    const trigger = queryUploadTrigger();

    expect(element.querySelector('h1')?.textContent).toContain('Meus vídeos');
    expect(element.querySelector('.profile-videos__count')?.textContent).toContain(
      '1'
    );
    expect(element.querySelector('.profile-videos__upload')).toBeNull();
    expect(trigger.textContent).toContain('Adicionar vídeo');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('abre e fecha o compositor em MatDialog com foco restaurável', () => {
    fixture.debugElement
      .query(By.css('.profile-videos__upload-trigger'))
      .triggerEventHandler('click');
    detectComponentChanges();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    const [, config] = dialogOpen.mock.calls[0];
    expect(config).toMatchObject({
      ariaLabel: 'Adicionar vídeo ao perfil',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      closeOnNavigation: true,
      maxWidth: '100vw',
      maxHeight: '100dvh',
      position: {
        top: '0',
        right: '0',
      },
    });
    expect(component.uploadComposerOpen()).toBe(true);
    expect(queryUploadTrigger().getAttribute('aria-expanded')).toBe('true');

    component.closeUploadComposer();
    detectComponentChanges();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(component.uploadComposerOpen()).toBe(false);
    expect(queryUploadTrigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('adia o player e não anexa a URL antes da interação', () => {
    const element = fixture.nativeElement as HTMLElement;
    const deferredPlayer = element.querySelector(
      'video[data-playback-state="deferred"]'
    ) as HTMLVideoElement | null;

    expect(deferredPlayer).toBeTruthy();
    expect(deferredPlayer?.hasAttribute('src')).toBe(false);
    expect(deferredPlayer?.getAttribute('preload')).toBe('none');
    expect(
      element.querySelector('video[data-playback-state="ready"]')
    ).toBeNull();
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
      'button[aria-haspopup="dialog"]'
    );

    expect(emptyState.textContent).toContain('Sua biblioteca ainda está vazia');
    expect(firstUploadAction?.textContent).toContain('Adicionar primeiro vídeo');
  });
});