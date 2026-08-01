import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
import { PublicVideoShareActionsComponent } from './public-video-share-actions.component';

const VIDEO = {
  id: 'video_1',
  ownerUid: 'owner_1',
  title: 'Vídeo do perfil',
} as IPublicVideoItem;

describe('PublicVideoShareActionsComponent', () => {
  let sharePublicVideo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sharePublicVideo = vi.fn().mockResolvedValue('shared');

    TestBed.configureTestingModule({
      imports: [PublicVideoShareActionsComponent],
      providers: [
        { provide: MatDialog, useValue: { open: vi.fn() } },
        {
          provide: PublicVideoShareService,
          useValue: { sharePublicVideo },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showWarning: vi.fn(), showError: vi.fn() },
        },
      ],
    });
  });

  it('mantém feedback ocupado durante o compartilhamento externo', async () => {
    let finishShare: () => void = () => undefined;
    sharePublicVideo.mockImplementation(
      () => new Promise<string>((resolve) => {
        finishShare = () => resolve('shared');
      })
    );

    const fixture = TestBed.createComponent(PublicVideoShareActionsComponent);
    fixture.componentRef.setInput('video', VIDEO);
    fixture.detectChanges();

    const action = fixture.componentInstance.shareExternally();

    expect(fixture.componentInstance.sharingExternally()).toBe(true);
    expect(sharePublicVideo).toHaveBeenCalledWith(VIDEO);

    finishShare();
    await action;

    expect(fixture.componentInstance.sharingExternally()).toBe(false);
  });
});
