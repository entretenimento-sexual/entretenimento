import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { MediaVideoCommentsService } from 'src/app/core/services/media/media-video-comments.service';
import { MediaVideoRatingsService } from 'src/app/core/services/media/media-video-ratings.service';
import { PublicVideoAccessService } from 'src/app/core/services/media/public-video-access.service';
import { VideoViewTrackingService } from 'src/app/core/services/media/video-view-tracking.service';
import {
  IPublicVideoViewerData,
  PublicVideoViewerComponent,
} from './public-video-viewer.component';
import { PublicVideoQualifiedViewDetail } from './public-video-view-qualification.directive';

const NOW = 1_800_000_000_000;

function createVideo(overrides: Partial<IPublicVideoItem> = {}): IPublicVideoItem {
  return {
    id: 'video-1',
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: 'Vídeo vertical público',
    description: 'Descrição pública do vídeo.',
    alt: 'Vídeo vertical público',
    mimeType: 'video/mp4',
    sizeBytes: 4_096,
    durationMs: 25_000,
    createdAt: NOW - 10_000,
    publishedAt: NOW - 8_000,
    updatedAt: NOW - 5_000,
    lastViewedAt: NOW - 1_000,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 120,
    uniqueViewersCount: 80,
    reactionsCount: 12,
    commentsCount: 4,
    ratingsCount: 3,
    ratingAverage: 4.5,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 70,
    engagementScore: 68,
    score: 72,
    scoreBreakdown: {
      rankingScore: 72,
      qualityScore: 70,
      engagementScore: 68,
      safetyScore: 100,
    },
    owner: {
      nickname: 'Perfil teste',
      photoURL: null,
      gender: null,
      orientation: null,
      municipio: 'Niterói',
      estado: 'RJ',
    },
    url: 'https://example.test/video.mp4?token=temporary',
    posterUrl: 'https://example.test/poster.jpg?token=temporary',
    accessExpiresAt: NOW + 300_000,
    ...overrides,
  };
}

function dispatchPointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  coordinates: { x: number; y: number },
  overrides: Partial<{
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    button: number;
  }> = {}
): Event {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperties(event, {
    pointerId: { value: overrides.pointerId ?? 1 },
    pointerType: { value: overrides.pointerType ?? 'touch' },
    isPrimary: { value: overrides.isPrimary ?? true },
    button: { value: overrides.button ?? 0 },
    clientX: { value: coordinates.x },
    clientY: { value: coordinates.y },
  });

  target.dispatchEvent(event);
  return event;
}

describe('PublicVideoViewerComponent', () => {
  let fixture: ComponentFixture<PublicVideoViewerComponent>;
  const dialogRef = { close: vi.fn() };
  const videoViewTracking = {
    recordVideoView$: vi.fn(() => of(void 0)),
  };
  const publicVideoAccess = {
    refreshPublicVideoUrl$: vi.fn((video: IPublicVideoItem) => of(video)),
    invalidatePublicVideoAccess: vi.fn(),
  };
  const reactions = {
    getVideoLikesCount$: vi.fn(() => of(12)),
    isVideoLikedByViewer$: vi.fn(() => of(false)),
    toggleLikeVideo$: vi.fn(() => of({ liked: true })),
  };
  const comments = {
    watchVisibleComments$: vi.fn(() => of([])),
    createComment$: vi.fn(() => of('comment-1')),
    replyToComment$: vi.fn(() => of('reply-1')),
    hideComment$: vi.fn(() => of(true)),
    deleteComment$: vi.fn(() => of(true)),
  };
  const ratings = {
    watchSummary$: vi.fn(() => of({
      ratingsCount: 3,
      ratingAverage: 4.5,
    })),
    watchViewerRating$: vi.fn(() => of(null)),
    rateVideo$: vi.fn(() => of({ rating: 5 })),
  };
  const errorNotification = {
    showWarning: vi.fn(),
    showError: vi.fn(),
  };
  const data: IPublicVideoViewerData = {
    ownerUid: 'owner-1',
    items: [
      createVideo(),
      createVideo({
        id: 'video-2',
        title: 'Segundo vídeo',
        alt: 'Segundo vídeo',
        orderIndex: 1,
        url: 'https://example.test/video-2.mp4?token=temporary',
      }),
      createVideo({
        id: 'video-3',
        title: 'Terceiro vídeo',
        alt: 'Terceiro vídeo',
        orderIndex: 2,
        url: 'https://example.test/video-3.mp4?token=temporary',
      }),
    ],
    startIndex: 0,
    source: 'top',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());

    await TestBed.configureTestingModule({
      imports: [PublicVideoViewerComponent],
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: of({ uid: 'viewer-1' }) },
        },
        { provide: VideoViewTrackingService, useValue: videoViewTracking },
        { provide: PublicVideoAccessService, useValue: publicVideoAccess },
        { provide: MediaReactionsService, useValue: reactions },
        { provide: MediaVideoCommentsService, useValue: comments },
        { provide: MediaVideoRatingsService, useValue: ratings },
        { provide: ErrorNotificationService, useValue: errorNotification },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicVideoViewerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('renderiza o palco vertical com vídeo, perfil, metadados e trilho de ações', () => {
    const element = fixture.nativeElement as HTMLElement;
    const stage = element.querySelector('.public-video-viewer__stage');
    const video = element.querySelector('video');
    const actionRail = element.querySelector('.public-video-viewer__interactions');

    expect(stage).not.toBeNull();
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(actionRail).not.toBeNull();
    expect(element.textContent).toContain('Vídeo vertical público');
    expect(element.textContent).toContain('Perfil teste');
    expect(element.textContent).toContain('120 visualizações');
    expect(element.textContent).toContain('deslize para cima ou para baixo');
  });

  it('mantém os controles acessíveis sem contar a simples abertura', () => {
    const element = fixture.nativeElement as HTMLElement;
    const closeButton = element.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar visualizador de vídeo"]'
    );
    const previousButton = element.querySelector<HTMLButtonElement>(
      '[aria-label="Abrir vídeo anterior"]'
    );
    const nextButton = element.querySelector<HTMLButtonElement>(
      '[aria-label="Abrir próximo vídeo"]'
    );

    expect(closeButton).not.toBeNull();
    expect(previousButton?.disabled).toBe(true);
    expect(nextButton?.disabled).toBe(false);
    expect(videoViewTracking.recordVideoView$).not.toHaveBeenCalled();
  });

  it('navega ao próximo vídeo com gesto vertical para cima fora dos controles', () => {
    const metadata = fixture.nativeElement.querySelector(
      '.public-video-viewer__metadata'
    ) as HTMLElement;

    dispatchPointer(metadata, 'pointerdown', { x: 120, y: 520 });
    dispatchPointer(metadata, 'pointermove', { x: 124, y: 450 });
    dispatchPointer(metadata, 'pointerup', { x: 126, y: 390 });
    fixture.detectChanges();

    expect(fixture.componentInstance.current?.id).toBe('video-2');
    expect(fixture.componentInstance.navigationAnnouncement()).toBe(
      '2 de 3. Segundo vídeo.'
    );
  });

  it('ignora gesto iniciado sobre o vídeo para preservar controles nativos', () => {
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;

    dispatchPointer(video, 'pointerdown', { x: 120, y: 520 });
    dispatchPointer(video, 'pointerup', { x: 120, y: 380 });
    fixture.detectChanges();

    expect(fixture.componentInstance.current?.id).toBe('video-1');
  });

  it('ignora gesto predominantemente horizontal', () => {
    const metadata = fixture.nativeElement.querySelector(
      '.public-video-viewer__metadata'
    ) as HTMLElement;

    dispatchPointer(metadata, 'pointerdown', { x: 40, y: 500 });
    dispatchPointer(metadata, 'pointerup', { x: 170, y: 470 });
    fixture.detectChanges();

    expect(fixture.componentInstance.current?.id).toBe('video-1');
  });

  it('desativa o gesto enquanto o painel de comentários está aberto', () => {
    const metadata = fixture.nativeElement.querySelector(
      '.public-video-viewer__metadata'
    ) as HTMLElement;
    fixture.componentInstance.commentsExpanded.set(true);

    dispatchPointer(metadata, 'pointerdown', { x: 120, y: 520 });
    dispatchPointer(metadata, 'pointerup', { x: 120, y: 380 });
    fixture.detectChanges();

    expect(fixture.componentInstance.current?.id).toBe('video-1');
  });

  it('registra uma única vez após reprodução qualificada', () => {
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    const evidence: PublicVideoQualifiedViewDetail = {
      sessionId: 'session_1234567890abcdef',
      playbackMs: 6_250,
      durationMs: 25_000,
      qualifiedAt: NOW,
    };

    const qualifiedEvent = () => new CustomEvent<PublicVideoQualifiedViewDetail>(
      'publicVideoQualifiedView',
      {
        detail: evidence,
        bubbles: true,
        composed: true,
      }
    );

    video.dispatchEvent(qualifiedEvent());
    video.dispatchEvent(qualifiedEvent());

    expect(videoViewTracking.recordVideoView$).toHaveBeenCalledTimes(1);
    expect(videoViewTracking.recordVideoView$).toHaveBeenCalledWith(
      'owner-1',
      'video-1',
      'top',
      evidence
    );
  });

  it('renova a URL quando o elemento de vídeo informa erro de acesso', async () => {
    const renewed = createVideo({
      url: 'https://example.test/video.mp4?token=renewed',
      posterUrl: 'https://example.test/poster.jpg?token=renewed',
      accessExpiresAt: NOW + 600_000,
    });
    publicVideoAccess.refreshPublicVideoUrl$.mockReturnValueOnce(of(renewed));

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    video.dispatchEvent(new Event('error'));
    await Promise.resolve();
    fixture.detectChanges();

    expect(publicVideoAccess.refreshPublicVideoUrl$).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video-1', ownerUid: 'owner-1' })
    );
    expect(fixture.componentInstance.current?.url).toContain('token=renewed');
    expect(video.load).toHaveBeenCalled();
  });

  it('remove o estado ocupado quando o navegador sinaliza que pode reproduzir', () => {
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;

    expect(video.getAttribute('aria-busy')).toBe('true');

    video.dispatchEvent(new Event('canplay'));
    fixture.detectChanges();

    expect(video.getAttribute('aria-busy')).toBeNull();
  });

  it('fecha o diálogo pelo controle principal sem ruído da API de mídia', () => {
    const closeButton = fixture.nativeElement.querySelector(
      '[aria-label="Fechar visualizador de vídeo"]'
    ) as HTMLButtonElement;

    closeButton.click();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });
});
