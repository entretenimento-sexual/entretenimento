import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicPreviewQueryService } from 'src/app/core/services/media/media-public-preview-query.service';
import { PublicMixedMediaViewerLauncherService } from '../../services/public-mixed-media-viewer-launcher.service';
import { ProfileMediaShowcaseComponent } from './profile-media-showcase.component';

describe('ProfileMediaShowcaseComponent', () => {
  let fixture: ComponentFixture<ProfileMediaShowcaseComponent>;
  let mediaItems: IPublicProfileMediaItem[];
  let totalPhotosCount: number;
  let totalVideosCount: number;
  let mediaPublicPreview: {
    getProfilePublicMediaPreview$: ReturnType<typeof vi.fn>;
  };

  const mixedViewerLauncher = {
    open$: vi.fn(() => of(void 0)),
  };

  const photo: IPublicPhotoItem = {
    id: 'photo-1',
    ownerUid: 'target-uid',
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: 'https://example.test/photo.jpg',
    alt: 'Foto pública de teste',
    createdAt: Date.now(),
    publishedAt: Date.now(),
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
  };

  const video = {
    id: 'video-1',
    ownerUid: 'target-uid',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: 'Vídeo público de teste',
    description: null,
    alt: 'Capa do vídeo público de teste',
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 12_000,
    createdAt: Date.now(),
    publishedAt: Date.now(),
    updatedAt: Date.now(),
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    commentsCount: 0,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 0,
    },
    owner: null,
    url: 'https://example.test/video.mp4',
    posterUrl: 'https://example.test/video.jpg',
    accessExpiresAt: Date.now() + 60_000,
  } as IPublicVideoItem;

  beforeEach(async () => {
    vi.clearAllMocks();
    mediaItems = [photo];
    totalPhotosCount = 1;
    totalVideosCount = 0;
    mediaPublicPreview = {
      getProfilePublicMediaPreview$: vi.fn(() => of({
        items: [...mediaItems],
        photosCount: totalPhotosCount,
        videosCount: totalVideosCount,
        totalCount: totalPhotosCount + totalVideosCount,
      })),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileMediaShowcaseComponent],
      providers: [
        provideRouter([]),
        {
          provide: MediaPublicPreviewQueryService,
          useValue: mediaPublicPreview,
        },
        {
          provide: PublicMixedMediaViewerLauncherService,
          useValue: mixedViewerLauncher,
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileMediaShowcaseComponent);
    fixture.componentRef.setInput('ownerUid', 'target-uid');
    fixture.componentRef.setInput('profileName', 'Pessoa alvo');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('consulta somente a prévia limitada a cinco mídias', () => {
    expect(mediaPublicPreview.getProfilePublicMediaPreview$).toHaveBeenCalledWith(
      'target-uid',
      5,
      { propagateErrors: true }
    );
  });

  it('renderiza a mídia como prévia pública acionável', () => {
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item')
    );
    const image = item.query(By.css('img')).nativeElement as HTMLImageElement;
    const ariaLabel = item.nativeElement.getAttribute('aria-label') as string;

    expect(item).toBeTruthy();
    expect(image.src).toContain('photo.jpg');
    expect(ariaLabel).toContain('Foto pública de teste');
    expect(ariaLabel).toContain('1 de 1');
  });

  it('abre a prévia preservando a ordem mista de foto e vídeo', async () => {
    mediaItems = [photo, video];
    totalPhotosCount = 1;
    totalVideosCount = 1;

    await fixture.componentInstance.openMedia(photo, 0);

    expect(mixedViewerLauncher.open$).toHaveBeenCalledWith({
      items: [photo, video],
      selected: photo,
      source: 'profile',
    });
  });

  it('preserva o total público sem precisar hidratar todos os itens', async () => {
    mediaItems = [photo, video];
    totalPhotosCount = 7;
    totalVideosCount = 4;
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(
      By.css('.profile-media-showcase__item')
    );
    const firstAriaLabel = buttons[0].nativeElement.getAttribute(
      'aria-label'
    ) as string;

    expect(buttons).toHaveLength(2);
    expect(firstAriaLabel).toContain('1 de 11');
  });

  it('usa o tipo disponível como título sem repetir a navegação', () => {
    const header = fixture.debugElement.query(
      By.css('.profile-media-showcase__header')
    );
    const heading = header.query(By.css('h2')).nativeElement as HTMLElement;
    const links = header.query(
      By.css('.profile-media-showcase__links')
    ).nativeElement as HTMLElement;
    const text = fixture.nativeElement.textContent as string;

    expect(heading.textContent?.trim()).toBe('Fotos');
    expect(links.textContent?.trim()).toContain('Ver todas');
    expect(links.textContent).not.toContain('Fotos');
    expect(text).not.toContain('Galeria de');
    expect(text).not.toContain('Toque em uma mídia');
    expect(text).not.toContain('Abrir destaque');
    expect(text).not.toContain('Capa');
  });

  it('mantém a grade abaixo do cabeçalho da seção', () => {
    const header = fixture.debugElement.query(
      By.css('.profile-media-showcase__header')
    ).nativeElement as HTMLElement;
    const grid = fixture.debugElement.query(
      By.css('.profile-media-showcase__grid')
    ).nativeElement as HTMLElement;

    expect(
      Boolean(
        header.compareDocumentPosition(grid) &
          Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
  });

  it('usa a mesma grade para foto única sem aplicar destaque variável', () => {
    const grid = fixture.debugElement.query(
      By.css('.profile-media-showcase__grid')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item')
    ).nativeElement as HTMLElement;

    expect(grid.className).toBe('profile-media-showcase__grid');
    expect(
      item.classList.contains('profile-media-showcase__item--featured')
    ).toBe(false);
  });

  it('contextualiza a seção quando há somente vídeos', async () => {
    mediaItems = [video];
    totalPhotosCount = 0;
    totalVideosCount = 1;
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heading = fixture.debugElement.query(
      By.css('.profile-media-showcase__header h2')
    ).nativeElement as HTMLElement;
    const links = fixture.debugElement.query(
      By.css('.profile-media-showcase__links')
    ).nativeElement as HTMLElement;
    const grid = fixture.debugElement.query(
      By.css('.profile-media-showcase__grid')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item--video')
    ).nativeElement as HTMLElement;

    expect(heading.textContent?.trim()).toBe('Vídeos');
    expect(links.textContent?.trim()).toContain('Ver todos');
    expect(grid.className).toBe('profile-media-showcase__grid');
    expect(
      item.classList.contains('profile-media-showcase__item--featured')
    ).toBe(false);
  });

  it('mantém atalhos separados quando fotos e vídeos coexistem', async () => {
    mediaItems = [photo, video];
    totalPhotosCount = 1;
    totalVideosCount = 1;
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heading = fixture.debugElement.query(
      By.css('.profile-media-showcase__header h2')
    ).nativeElement as HTMLElement;
    const links = fixture.debugElement.query(
      By.css('.profile-media-showcase__links')
    ).nativeElement as HTMLElement;

    expect(heading.textContent?.trim()).toBe('Mídias');
    expect(links.textContent).toContain('Fotos');
    expect(links.textContent).toContain('Vídeos');
    expect(links.textContent).not.toContain('Ver todas');
    expect(links.textContent).not.toContain('Ver todos');
  });
});
