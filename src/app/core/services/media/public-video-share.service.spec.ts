import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  PublicVideoShareService,
  buildPublicVideoCanonicalPath,
  canShareVideoExternally,
} from './public-video-share.service';

describe('PublicVideoShareService', () => {
  let service: PublicVideoShareService;
  let errorNotification: {
    showSuccess: ReturnType<typeof vi.fn>;
    showWarning: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
  };
  let globalErrorHandler: { handleError: ReturnType<typeof vi.fn> };
  const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  const originalCanShare = Object.getOwnPropertyDescriptor(
    navigator,
    'canShare'
  );
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard'
  );

  beforeEach(() => {
    errorNotification = {
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
      showError: vi.fn(),
    };
    globalErrorHandler = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: { readyUid$: of('owner_1') } },
        {
          provide: ErrorNotificationService,
          useValue: errorNotification,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorHandler,
        },
      ],
    });

    service = TestBed.inject(PublicVideoShareService);
  });

  afterEach(() => {
    restoreNavigatorProperty('share', originalShare);
    restoreNavigatorProperty('canShare', originalCanShare);
    restoreNavigatorProperty('clipboard', originalClipboard);
    vi.restoreAllMocks();
  });

  it('monta endereço canônico sem incluir URL temporária do Storage', () => {
    expect(buildPublicVideoCanonicalPath('owner_1', 'video-1')).toBe(
      '/media/video/owner_1/video-1'
    );
    expect(buildPublicVideoCanonicalPath('../owner', 'video-1')).toBeNull();
  });

  it('allows only the signed-in owner to distribute external links', () => {
    expect(canShareVideoExternally('owner_1', 'owner_1')).toBe(true);
    expect(canShareVideoExternally('viewer_2', 'owner_1')).toBe(false);
    expect(canShareVideoExternally(null, 'owner_1')).toBe(false);
    expect(canShareVideoExternally('owner_1', '../owner')).toBe(false);
  });

  it('denies external sharing for third parties before calling native share or clipboard', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty('share', nativeShare);
    setNavigatorProperty('clipboard', { writeText });
    TestBed.inject(AuthSessionService).readyUid$ = of('viewer_2');
    const outcome = await service.sharePublicVideo({ ownerUid: 'owner_1', id: 'video-1' });
    expect(outcome).toBe('failed');
    expect(nativeShare).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(errorNotification.showWarning).toHaveBeenCalledWith(
      'Somente o proprietário pode compartilhar este vídeo fora da plataforma.'
    );
  });

  it('usa o compartilhamento nativo quando o navegador permite', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty('share', nativeShare);
    setNavigatorProperty('canShare', vi.fn(() => true));

    const outcome = await service.sharePublicVideo({
      ownerUid: 'owner_1',
      id: 'video-1',
    });

    expect(outcome).toBe('shared');
    expect(nativeShare).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${document.location.origin}/media/video/owner_1/video-1`,
      })
    );
    expect(errorNotification.showSuccess).toHaveBeenCalledWith(
      'Vídeo compartilhado.'
    );
  });

  it('copia o endereço quando o compartilhamento nativo não existe', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty('share', undefined);
    setNavigatorProperty('canShare', undefined);
    setNavigatorProperty('clipboard', { writeText });

    const outcome = await service.sharePublicVideo({
      ownerUid: 'owner_1',
      id: 'video-1',
    });

    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(
      `${document.location.origin}/media/video/owner_1/video-1`
    );
    expect(errorNotification.showSuccess).toHaveBeenCalledWith(
      'Link do vídeo copiado.'
    );
  });

  it('não transforma o cancelamento da folha de compartilhamento em erro', async () => {
    setNavigatorProperty(
      'share',
      vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'))
    );
    setNavigatorProperty('canShare', vi.fn(() => true));

    const outcome = await service.sharePublicVideo({
      ownerUid: 'owner_1',
      id: 'video-1',
    });

    expect(outcome).toBe('cancelled');
    expect(errorNotification.showError).not.toHaveBeenCalled();
    expect(globalErrorHandler.handleError).not.toHaveBeenCalled();
  });
});

function setNavigatorProperty(
  property: 'share' | 'canShare' | 'clipboard',
  value: unknown
): void {
  Object.defineProperty(navigator, property, {
    configurable: true,
    value,
  });
}

function restoreNavigatorProperty(
  property: 'share' | 'canShare' | 'clipboard',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(navigator, property, descriptor);
    return;
  }

  delete (navigator as unknown as Record<string, unknown>)[property];
}
