import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoAccessService } from 'src/app/core/services/media/public-video-access.service';
import { PublicVideoCaptionTracksDirective } from './public-video-caption-tracks.directive';

@Component({
  standalone: true,
  imports: [PublicVideoCaptionTracksDirective],
  template: '<video appPublicVideoCaptionTracks [src]="source"></video>',
})
class CaptionHostComponent {
  source = 'https://example.test/video-1.mp4?token=one';
}

function createItem(overrides: Partial<IPublicVideoItem> = {}): IPublicVideoItem {
  return {
    id: 'video-1',
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'NONE',
    title: 'Vídeo',
    description: null,
    alt: 'Vídeo',
    mimeType: 'video/mp4',
    sizeBytes: 10,
    durationMs: 10_000,
    createdAt: 1,
    publishedAt: 1,
    updatedAt: 1,
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
      safetyScore: 100,
    },
    owner: null,
    url: 'https://example.test/video-1.mp4?token=one',
    posterUrl: null,
    accessExpiresAt: Date.now() + 300_000,
    captionTracks: [{
      id: 'captions-1',
      kind: 'captions',
      language: 'pt-BR',
      label: 'Português (Brasil)',
      url: 'https://example.test/captions.vtt?token=one',
      isDefault: true,
    }],
    ...overrides,
  };
}

describe('PublicVideoCaptionTracksDirective', () => {
  let fixture: ComponentFixture<CaptionHostComponent>;
  const accessService = {
    refreshPublicVideoUrl$: vi.fn((item: IPublicVideoItem) => of(item)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [CaptionHostComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { items: [createItem()], startIndex: 0 },
        },
        { provide: PublicVideoAccessService, useValue: accessService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CaptionHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('cria uma faixa captions com idioma, rótulo e URL temporária', () => {
    const track = fixture.nativeElement.querySelector('track');

    expect(track).not.toBeNull();
    expect(track.getAttribute('kind')).toBe('captions');
    expect(track.getAttribute('srclang')).toBe('pt-BR');
    expect(track.getAttribute('label')).toBe('Português (Brasil)');
    expect(track.getAttribute('src')).toContain('captions.vtt');
    expect(track.hasAttribute('default')).toBe(true);
  });

  it('remove a faixa criada pela plataforma ao destruir o host', () => {
    const video = fixture.nativeElement.querySelector('video');
    expect(video.querySelectorAll('track')).toHaveLength(1);

    fixture.destroy();

    expect(video.querySelectorAll('track')).toHaveLength(0);
  });
});
