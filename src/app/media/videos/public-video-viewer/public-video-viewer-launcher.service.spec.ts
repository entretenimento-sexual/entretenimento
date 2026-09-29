import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { PublicVideoViewerLauncherService } from './public-video-viewer-launcher.service';

function video(id: string): IPublicVideoItem {
  return {
    id,
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    title: 'Vídeo',
    description: null,
    alt: 'Vídeo',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    durationMs: 10_000,
    createdAt: 1,
    publishedAt: 1,
    updatedAt: 1,
    lastViewedAt: null,
    orderIndex: 0,
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
    url: null,
    posterUrl: null,
    accessExpiresAt: 0,
  };
}

describe('PublicVideoViewerLauncherService', () => {
  const dialog = {
    open: vi.fn((_component: unknown, _config: MatDialogConfig) => ({})),
  };
  const mediaError = {
    reportSilently: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        PublicVideoViewerLauncherService,
        { provide: MatDialog, useValue: dialog },
        { provide: MediaApplicationErrorService, useValue: mediaError },
      ],
    });
  });

  it('usa o mesmo contrato de foco e viewport dinâmica do viewer de Foto', async () => {
    const service = TestBed.inject(PublicVideoViewerLauncherService);

    await firstValueFrom(service.open$({
      items: [video('video-1')],
      startIndex: 0,
      source: 'profile',
    }));

    expect(dialog.open).toHaveBeenCalledTimes(1);
    const config = dialog.open.mock.calls[0]?.[1];

    expect(config?.autoFocus).toBe('first-tabbable');
    expect(config?.restoreFocus).toBe(true);
    expect(config?.height).toBe('100dvh');
    expect(config?.maxHeight).toBe('100dvh');
    expect(config?.data.startIndex).toBe(0);
  });
});
