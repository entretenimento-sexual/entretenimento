import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { ProfileMediaShowcaseComponent } from './profile-media-showcase.component';

describe('ProfileMediaShowcaseComponent', () => {
  let fixture: ComponentFixture<ProfileMediaShowcaseComponent>;
  let mediaItems: IPublicProfileMediaItem[];

  const photo: IPublicPhotoItem = {
    id: 'photo-1',
    ownerUid: 'target-uid',
    mediaType: 'PHOTO',
    url: 'https://example.test/photo.jpg',
    alt: 'Foto pública de teste',
    createdAt: Date.now(),
    publishedAt: Date.now(),
    visibility: 'PUBLIC',
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
    mediaItems = [photo];

    await TestBed.configureTestingModule({
      imports: [ProfileMediaShowcaseComponent],
      providers: [
        provideRouter([]),
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: MediaPublicQueryService,
          useValue: {
            getProfilePublicMedia$: vi.fn(() => of(mediaItems)),
          },
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

  it('renderiza a mídia como conteúdo principal', () => {
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

  it('não renderiza cabeçalho, contadores ou instruções duplicadas', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(
      fixture.debugElement.query(By.css('.profile-media-showcase__header'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.profile-media-showcase__summary'))
    ).toBeNull();
    expect(text).not.toContain('Mídias públicas');
    expect(text).not.toContain('Galeria de');
    expect(text).not.toContain('Toque em uma mídia');
    expect(text).not.toContain('Abrir destaque');
    expect(text).not.toContain('Capa');
  });

  it('mantém apenas o atalho compacto para a galeria completa', () => {
    const links = fixture.debugElement.query(
      By.css('.profile-media-showcase__links')
    ).nativeElement as HTMLElement;

    expect(links.textContent).toContain('Fotos');
    expect(links.textContent).not.toContain('Ver todas as fotos');
  });

  it('usa a mesma grade para foto única sem aplicar destaque variável', () => {
    const mosaic = fixture.debugElement.query(
      By.css('.profile-media-showcase__mosaic')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item')
    ).nativeElement as HTMLElement;

    expect(mosaic.className).toBe('profile-media-showcase__mosaic');
    expect(
      item.classList.contains('profile-media-showcase__item--featured')
    ).toBe(false);
  });

  it('usa a mesma grade para vídeo sem criar layout especial', async () => {
    mediaItems = [video];
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const mosaic = fixture.debugElement.query(
      By.css('.profile-media-showcase__mosaic')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item--video')
    ).nativeElement as HTMLElement;

    expect(mosaic.className).toBe('profile-media-showcase__mosaic');
    expect(
      item.classList.contains('profile-media-showcase__item--featured')
    ).toBe(false);
  });
});
