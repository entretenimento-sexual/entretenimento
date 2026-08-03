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

  it('renderiza a foto como prévia pública acionável', () => {
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

  it('exibe fotos em seção própria com quantidade e acesso completo', () => {
    const section = fixture.debugElement.query(
      By.css('.profile-media-showcase__section')
    );
    const heading = section.query(By.css('h2')).nativeElement as HTMLElement;
    const link = section.query(By.css('a')).nativeElement as HTMLAnchorElement;
    const text = fixture.nativeElement.textContent as string;

    expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe('Fotos 1');
    expect(link.textContent?.trim()).toContain('Ver todas');
    expect(text).not.toContain('Mídias');
    expect(text).not.toContain('Toque em uma mídia');
    expect(text).not.toContain('Abrir destaque');
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

  it('usa grade uniforme para foto única sem destaque variável', () => {
    const grid = fixture.debugElement.query(
      By.css('.profile-media-showcase__grid')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item')
    ).nativeElement as HTMLElement;

    expect(grid.classList.contains('profile-media-showcase__grid')).toBe(true);
    expect(
      item.classList.contains('profile-media-showcase__item--featured')
    ).toBe(false);
  });

  it('contextualiza a seção quando há somente vídeos', async () => {
    mediaItems = [video];
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heading = fixture.debugElement.query(
      By.css('.profile-media-showcase__header h2')
    ).nativeElement as HTMLElement;
    const link = fixture.debugElement.query(
      By.css('.profile-media-showcase__header a')
    ).nativeElement as HTMLAnchorElement;
    const grid = fixture.debugElement.query(
      By.css('.profile-media-showcase__grid--videos')
    ).nativeElement as HTMLElement;
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item--video')
    ).nativeElement as HTMLElement;

    expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe('Vídeos 1');
    expect(link.textContent?.trim()).toContain('Ver todos');
    expect(grid).toBeTruthy();
    expect(item).toBeTruthy();
  });

  it('mantém fotos e vídeos em seções e grades independentes', async () => {
    mediaItems = [photo, video];
    fixture.componentInstance.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sections = fixture.debugElement.queryAll(
      By.css('.profile-media-showcase__section')
    );
    const headings = fixture.debugElement.queryAll(
      By.css('.profile-media-showcase__header h2')
    ).map((item) =>
      (item.nativeElement as HTMLElement).textContent
        ?.replace(/\s+/g, ' ')
        .trim()
    );
    const links = fixture.debugElement.queryAll(
      By.css('.profile-media-showcase__header a')
    ).map((item) =>
      (item.nativeElement as HTMLAnchorElement).textContent?.trim()
    );

    expect(sections).toHaveLength(2);
    expect(headings).toEqual(['Fotos 1', 'Vídeos 1']);
    expect(links).toEqual(['Ver todas', 'Ver todos']);
    expect(
      fixture.debugElement.queryAll(By.css('.profile-media-showcase__grid'))
    ).toHaveLength(2);
  });
});
