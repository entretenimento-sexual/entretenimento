import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CameraCaptureService } from 'src/app/core/services/media/camera-capture.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedComponent } from './community-feed.component';

describe('CommunityFeedComponent attachment menu', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
    createPost$: vi.fn(),
    moderatePost$: vi.fn(),
    toggleReaction$: vi.fn(),
  };

  const cameraCaptureMock = {
    openCamera$: vi.fn(),
    stopStream: vi.fn(),
  };

  const geolocationMock = {
    currentPosition$: vi.fn(),
    watchPosition$: vi.fn(),
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
    repositoryMock.watchLatestChanges$.mockReturnValue(NEVER);
    geolocationMock.currentPosition$.mockReturnValue(of({
      latitude: -22.91,
      longitude: -43.18,
      accuracy: 800,
    }));
    geolocationMock.watchPosition$.mockReturnValue(of(
      { latitude: -22.91, longitude: -43.18, accuracy: 850 },
      { latitude: -22.9121, longitude: -43.1812, accuracy: 90 },
      { latitude: -22.912345, longitude: -43.187654, accuracy: 18 }
    ));

    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        {
          provide: CommunityFeedCommentRepository,
          useValue: {
            getPage$: vi.fn(() => of({ items: [], nextCursor: null, generatedAt: Date.now() })),
            getRepliesPage$: vi.fn(() => of({ items: [], nextCursor: null, generatedAt: Date.now() })),
            watchCommentCount$: vi.fn(() => of(0)),
            createComment$: vi.fn(),
            createReply$: vi.fn(),
            moderateComment$: vi.fn(),
            moderateReply$: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
            showError: vi.fn(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
        { provide: GeolocationService, useValue: geolocationMock },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: of(true),
            readyUid$: of('u1'),
            currentAuthUser: { uid: 'u1' },
          },
        },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        { provide: CameraCaptureService, useValue: cameraCaptureMock },
        { provide: PhotoEditorLauncherService, useValue: { open$: vi.fn() } },
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

  it('mantém Galeria, Câmera e Localização no mesmo menu de anexos', () => {
    const fixture = createFixture();
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;
    const labels = Array.from(
      menu.querySelectorAll('.community-post__menu-panel button')
    ).map((button) => button.textContent?.replace(/\s+/g, ' ').trim());

    expect(labels).toEqual(expect.arrayContaining([
      'Galeria',
      'Câmera',
      'Localização',
    ]));
    expect(labels).toHaveLength(3);
  });

  it('só referencia o helper do composer quando ele realmente existe no DOM', () => {
    const fixture = createFixture();
    let textarea = fixture.nativeElement.querySelector(
      '#community-feed-post-text'
    ) as HTMLTextAreaElement;

    expect(textarea.getAttribute('aria-describedby')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('#community-feed-post-help')
    ).toBeNull();

    fixture.componentInstance.selectedAttachment.set({
      kind: 'image',
      file: new File(['photo'], 'foto.webp', { type: 'image/webp' }),
      previewUrl: null,
    });
    fixture.detectChanges();

    textarea = fixture.nativeElement.querySelector(
      '#community-feed-post-text'
    ) as HTMLTextAreaElement;
    const helper = fixture.nativeElement.querySelector(
      '#community-feed-post-help'
    ) as HTMLElement | null;

    expect(textarea.getAttribute('aria-describedby')).toBe(
      'community-feed-post-help'
    );
    expect(helper).not.toBeNull();
  });

  it('fecha o menu ao pressionar fora da superfície de anexos', () => {
    const fixture = createFixture();
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;

    menu.open = true;
    fixture.detectChanges();
    expect(menu.open).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(menu.open).toBe(false);
  });

  it('não fecha ao interagir dentro do próprio painel', () => {
    const fixture = createFixture();
    const menu = fixture.nativeElement.querySelector(
      '.community-feed__attachment-menu'
    ) as HTMLDetailsElement;
    const panel = menu.querySelector('.community-post__menu-panel') as HTMLElement;

    menu.open = true;
    fixture.detectChanges();
    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(menu.open).toBe(true);
  });

  it('observa refinamentos e mantém a coordenada com menor margem de erro', () => {
    const fixture = createFixture();

    fixture.componentInstance.shareApproximateLocation();
    fixture.detectChanges();

    expect(geolocationMock.watchPosition$).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 8_000,
      maximumAge: 0,
    });
    expect(fixture.componentInstance.selectedAttachment()).toMatchObject({
      kind: 'location',
      latitude: -22.912345,
      longitude: -43.187654,
      precision: 'precise',
      accuracyMeters: 18,
    });
  });
});
