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
  let openDialog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sharePublicVideo = vi.fn().mockResolvedValue('shared');
    openDialog = vi.fn();

    TestBed.configureTestingModule({
      imports: [PublicVideoShareActionsComponent],
      providers: [
        { provide: MatDialog, useValue: { open: openDialog } },
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

  it('mostra uma única ação permanente e abre opções sob demanda', () => {
    const fixture = TestBed.createComponent(PublicVideoShareActionsComponent);
    fixture.componentRef.setInput('video', VIDEO);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      '[aria-label="Opções para compartilhar vídeo"]'
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.querySelectorAll('.public-video-share-action'))
      .toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();

    trigger.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.menuOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Compartilhar fora');
    expect(fixture.nativeElement.textContent).toContain('Enviar em conversa');
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

    fixture.componentInstance.menuOpen.set(true);
    const action = fixture.componentInstance.shareExternally();

    expect(fixture.componentInstance.menuOpen()).toBe(false);
    expect(fixture.componentInstance.sharingExternally()).toBe(true);
    expect(sharePublicVideo).toHaveBeenCalledWith(VIDEO);

    finishShare();
    await action;

    expect(fixture.componentInstance.sharingExternally()).toBe(false);
  });

  it('abre o seletor de conversas pela opção secundária', async () => {
    const fixture = TestBed.createComponent(PublicVideoShareActionsComponent);
    fixture.componentRef.setInput('video', VIDEO);
    fixture.detectChanges();

    await fixture.componentInstance.sendToConversation();

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: {
          video: {
            id: 'video_1',
            ownerUid: 'owner_1',
            title: 'Vídeo do perfil',
          },
        },
      })
    );
  });
});
