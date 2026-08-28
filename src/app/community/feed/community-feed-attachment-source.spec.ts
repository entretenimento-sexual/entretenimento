import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CameraCaptureService } from 'src/app/core/services/media/camera-capture.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { provideCommunityFeedCacheTestDouble } from './community-feed-cache.testing';
import { CommunityFeedComponent } from './community-feed.component';

describe('CommunityFeedComponent attachment sources', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
    createPost$: vi.fn(),
    moderatePost$: vi.fn(),
    toggleReaction$: vi.fn(),
  };
  const commentRepositoryMock = {
    getPage$: vi.fn(),
    createComment$: vi.fn(),
    moderateComment$: vi.fn(),
  };
  const cameraMock = {
    openCamera$: vi.fn(),
    captureFrame$: vi.fn(),
    stopStream: vi.fn(),
  };
  const photoEditorMock = {
    editFile$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    repositoryMock.getItems$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    repositoryMock.watchLatestChanges$.mockReturnValue(of([]));
    cameraMock.openCamera$.mockReturnValue(
      of({ getTracks: () => [] } as unknown as MediaStream)
    );
    photoEditorMock.editFile$.mockImplementation((file: File) => of({
      kind: 'image',
      file: new File(['editada'], `editada-${file.name}`, { type: file.type }),
      imageStateStr: '{"version":2}',
      width: 1080,
      height: 1080,
      context: 'community-feed',
      preset: 'social-feed',
      metadataStripped: true,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        provideCommunityFeedCacheTestDouble(),
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        { provide: CommunityFeedCommentRepository, useValue: commentRepositoryMock },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        { provide: CameraCaptureService, useValue: cameraMock },
        { provide: PhotoEditorLauncherService, useValue: photoEditorMock },
        {
          provide: AuthSessionService,
          useValue: { currentAuthUser: { uid: 'u1' } },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  function createFixture() {
    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.componentRef.setInput('canInteract', true);
    fixture.componentRef.setInput('viewerRole', 'member');
    fixture.detectChanges();
    return fixture;
  }

  it('separa Galeria e Câmera e abre a câmera no primeiro acionamento', () => {
    const fixture = createFixture();
    const galleryInput = fixture.nativeElement.querySelector(
      '#community-feed-gallery-input'
    ) as HTMLInputElement | null;
    const cameraInput = fixture.nativeElement.querySelector(
      '#community-feed-camera-input'
    ) as HTMLInputElement | null;
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement | null;
    const trigger = menu?.querySelector('summary') as HTMLElement | null;

    expect(galleryInput).not.toBeNull();
    expect(cameraInput).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(menu?.open).toBe(false);

    trigger?.click();
    fixture.detectChanges();
    expect(menu?.open).toBe(true);

    expect(galleryInput?.getAttribute('accept')).toBe(
      'image/jpeg,image/png,image/webp'
    );
    expect(galleryInput?.hasAttribute('capture')).toBe(false);
    expect(cameraInput?.getAttribute('accept')).toBe(
      'image/jpeg,image/png,image/webp'
    );
    expect(cameraInput?.getAttribute('capture')).toBe('environment');
    expect(menu?.textContent).toContain('Galeria');
    expect(menu?.textContent).toContain('Câmera');

    const cameraAction = Array.from(
      menu?.querySelectorAll('button') ?? []
    ).find((button) => button.textContent?.includes('Câmera'));
    expect(cameraAction).toBeDefined();

    cameraAction?.click();
    fixture.detectChanges();

    expect(menu?.open).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('fecha o menu ao clicar fora e ao pressionar Escape', () => {
    const fixture = createFixture();
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;
    const trigger = menu.querySelector('summary') as HTMLElement;

    trigger.click();
    fixture.detectChanges();
    expect(menu.open).toBe(true);

    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );
    fixture.detectChanges();
    expect(menu.open).toBe(false);

    trigger.click();
    fixture.detectChanges();
    expect(menu.open).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();
    expect(menu.open).toBe(false);
  });

  it('não fecha o menu em interação interna antes da ação escolhida', () => {
    const fixture = createFixture();
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;
    const trigger = menu.querySelector('summary') as HTMLElement;
    const panel = menu.querySelector(
      '.community-post__menu-panel'
    ) as HTMLElement;

    trigger.click();
    fixture.detectChanges();
    expect(menu.open).toBe(true);

    panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menu.open).toBe(true);
  });

  it('fecha o menu para Galeria e envia a foto escolhida ao editor canônico', () => {
    const fixture = createFixture();
    const galleryInput = fixture.nativeElement.querySelector(
      '#community-feed-gallery-input'
    ) as HTMLInputElement;
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;
    const trigger = menu.querySelector('summary') as HTMLElement;

    trigger.click();
    fixture.detectChanges();

    const galleryAction = Array.from(menu.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Galeria'));
    expect(galleryAction).toBeDefined();

    galleryAction?.click();
    fixture.detectChanges();
    expect(menu.open).toBe(false);

    const sourceFile = new File(['foto'], 'galeria.jpg', { type: 'image/jpeg' });
    Object.defineProperty(galleryInput, 'files', {
      configurable: true,
      value: [sourceFile],
    });
    galleryInput.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    expect(photoEditorMock.editFile$).toHaveBeenCalledWith(sourceFile, {
      source: 'community-feed-gallery',
      context: 'community-feed',
      preset: 'social-feed',
    });
    expect(fixture.componentInstance.selectedAttachment()?.file.name)
      .toBe('editada-galeria.jpg');
  });
});
