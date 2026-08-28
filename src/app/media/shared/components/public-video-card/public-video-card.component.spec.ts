import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { PublicVideoMetadataPreloadService } from 'src/app/core/services/media/public-video-metadata-preload.service';
import { PublicVideoCardComponent } from './public-video-card.component';

const VIDEO: IPublicVideoItem = {
  id: 'video-1',
  ownerUid: 'owner-1',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'SIGNED_URL',
  title: 'Vídeo público',
  description: 'Descrição do vídeo',
  alt: 'Capa do vídeo público',
  mimeType: 'video/mp4',
  sizeBytes: 2_048,
  durationMs: 65_000,
  createdAt: Date.now() - 60_000,
  publishedAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  lastViewedAt: null,
  visibility: 'PUBLIC',
  orderIndex: 0,
  moderationStatus: 'APPROVED',
  moderationReason: null,
  reactionsEnabled: true,
  commentsEnabled: true,
  ratingsEnabled: true,
  viewsCount: 42,
  uniqueViewersCount: 20,
  reactionsCount: 5,
  commentsCount: 3,
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
    safetyScore: 100,
  },
  owner: {
    nickname: 'Pessoa teste',
    photoURL: null,
    gender: null,
    orientation: null,
    municipio: null,
    estado: null,
  },
  url: null,
  posterUrl: 'https://example.test/poster.webp?token=preview',
  accessExpiresAt: Date.now() + 300_000,
};

describe('PublicVideoCardComponent', () => {
  let fixture: ComponentFixture<PublicVideoCardComponent>;
  let component: PublicVideoCardComponent;

  const reactions = {
    isPhotoLikedByViewer$: vi.fn(() => of(false)),
    isVideoLikedByViewer$: vi.fn(() => of(false)),
    toggleLikePhotoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 6, score: 0 })
    ),
    toggleLikeVideoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 6, score: 0 })
    ),
  };

  const notifications = {
    showWarning: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, PublicVideoCardComponent],
      providers: [
        {
          provide: PublicVideoMetadataPreloadService,
          useValue: { preloadMetadata: vi.fn(() => false) },
        },
        { provide: MediaReactionsService, useValue: reactions },
        { provide: ErrorNotificationService, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicVideoCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('video', VIDEO);
    fixture.componentRef.setInput('viewerUid', 'viewer-1');
    fixture.componentRef.setInput('engagementActions', true);
    fixture.detectChanges();
  });

  it('renderiza a variante feed com ação acessível e métricas', () => {
    const card = fixture.debugElement.query(By.css('.public-video-card--feed'));
    const preview = fixture.debugElement.query(By.css('.public-video-card__preview'));
    const actions = fixture.debugElement.queryAll(
      By.css('app-public-media-engagement-actions button')
    );

    expect(card).toBeTruthy();
    expect(preview.attributes['aria-label']).toBe('Assistir Vídeo público.');
    expect(fixture.nativeElement.textContent).toContain('Pessoa teste');
    expect(fixture.nativeElement.textContent).toContain('1:05');
    expect(fixture.nativeElement.textContent).toContain('42');
    expect(actions).toHaveLength(2);
    expect(actions[0].nativeElement.textContent).toContain('5');
    expect(actions[1].nativeElement.textContent).toContain('3');
  });

  it('emite preview somente quando o card não está abrindo', () => {
    const emit = vi.spyOn(component.preview, 'emit');
    const preview = fixture.debugElement.query(By.css('.public-video-card__preview'));

    preview.triggerEventHandler('click');
    expect(emit).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('opening', true);
    fixture.detectChanges();

    const busyPreview = fixture.debugElement.query(
      By.css('.public-video-card__preview')
    );
    expect(busyPreview.nativeElement.disabled).toBe(true);
    expect(busyPreview.attributes['aria-label']).toBe('Abrindo Vídeo público.');
  });

  it('propaga o pedido de comentários para o container abrir o viewer canônico', () => {
    const emit = vi.spyOn(component.commentsRequested, 'emit');
    const comments = fixture.debugElement.queryAll(
      By.css('app-public-media-engagement-actions button')
    )[1];

    comments.triggerEventHandler('click', null);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('preserva métricas estáticas quando ações não são habilitadas', () => {
    fixture.componentRef.setInput('engagementActions', false);
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('app-public-media-engagement-actions'))
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('5');
    expect(fixture.nativeElement.textContent).toContain('3');
  });

  it('renderiza highlight como preview vertical sem ações de feed', () => {
    fixture.componentRef.setInput('variant', 'highlight');
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('.public-video-card--highlight'))
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('.public-video-card__preview--portrait'))
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('.public-video-card__header'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('app-public-media-engagement-actions'))
    ).toBeNull();
  });

  it('emite falha de poster para o container aplicar fallback e debug', () => {
    const emit = vi.spyOn(component.posterError, 'emit');
    const image = fixture.debugElement.query(By.css('.public-video-card__preview img'));

    image.triggerEventHandler('error');

    expect(emit).toHaveBeenCalledTimes(1);
  });
});
