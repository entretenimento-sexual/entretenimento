import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoViewerLauncherService } from './public-photo-viewer-launcher.service';

function photo(ownerUid: string, id: string): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    url: `https://example.com/${ownerUid}/${id}.jpg`,
    createdAt: 100,
    publishedAt: 100,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
    commentsEnabled: true,
    commentsPolicy: 'EVERYONE',
    reactionsEnabled: true,
  } as IPublicPhotoItem;
}

describe('PublicPhotoViewerLauncherService', () => {
  const dialog = {
    open: vi.fn(),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        PublicPhotoViewerLauncherService,
        { provide: MatDialog, useValue: dialog },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });
  });

  it('preserva fila mista, contexto social e seleção por identidade composta', async () => {
    const service = TestBed.inject(PublicPhotoViewerLauncherService);
    const ownerA = photo('owner-a', 'a-1');
    const ownerBFirst = photo('owner-b', 'b-1');
    const ownerBSecond = photo('owner-b', 'b-2');
    const continuationContext = {
      connectionOwnerUids: ['friend-1'],
      compatibleOwnerUids: ['compatible-1'],
    };

    await firstValueFrom(service.open$({
      items: [ownerA, ownerBFirst, ownerBSecond],
      selected: ownerBSecond,
      source: 'latest',
      continuationContext,
    }));

    expect(dialog.open).toHaveBeenCalledTimes(1);
    const config = dialog.open.mock.calls[0]?.[1];

    expect(config?.data.ownerUid).toBe('owner-b');
    expect(config?.data.startIndex).toBe(2);
    expect(config?.data.source).toBe('latest');
    expect(config?.data.continuationContext).toEqual(continuationContext);
    expect(config?.data.items.map((item: { ownerUid?: string }) => item.ownerUid))
      .toEqual(['owner-a', 'owner-b', 'owner-b']);
  });

  it('recusa foto que não esteja pública e aprovada na fila', async () => {
    const service = TestBed.inject(PublicPhotoViewerLauncherService);
    const selected = {
      ...photo('owner-a', 'a-1'),
      moderationStatus: 'FLAGGED',
    } as IPublicPhotoItem;

    await expect(firstValueFrom(service.open$({
      items: [selected],
      selected,
      source: 'latest',
    }))).rejects.toThrow('não está mais disponível');

    expect(dialog.open).not.toHaveBeenCalled();
  });
});
