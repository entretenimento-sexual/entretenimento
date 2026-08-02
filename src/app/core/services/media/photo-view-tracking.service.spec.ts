import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  PhotoViewTrackingService,
  type PhotoViewSession,
} from './photo-view-tracking.service';

const SESSION: PhotoViewSession = {
  ownerUid: 'owner-1',
  photoId: 'photo-1',
  sessionId: 'a'.repeat(43),
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_600_000,
};

describe('PhotoViewTrackingService', () => {
  let service: PhotoViewTrackingService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SESSION.issuedAt));

    TestBed.configureTestingModule({
      providers: [
        PhotoViewTrackingService,
        { provide: Functions, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: { deferPromise$: vi.fn() },
        },
        {
          provide: AuthSessionService,
          useValue: { uid$: of('viewer-1') },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(PhotoViewTrackingService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('não envia registro sem evidência qualificada', () => {
    const next = vi.fn();

    service.recordPhotoView$(
      'owner-1',
      'photo-1',
      'profile'
    ).subscribe(next);

    expect(next).toHaveBeenCalledWith(undefined);
  });

  it('registra depois de dois segundos com a página visível', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    vi.spyOn(service, 'preparePhotoViewSession$').mockReturnValue(of(SESSION));
    const record = vi.spyOn(service, 'recordPhotoView$')
      .mockReturnValue(of(void 0));

    service.trackQualifiedPhotoView$(
      'owner-1',
      'photo-1',
      'discover'
    ).subscribe();

    vi.advanceTimersByTime(2_200);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      'owner-1',
      'photo-1',
      'discover',
      expect.objectContaining({
        sessionId: SESSION.sessionId,
        visibleMs: expect.any(Number),
        qualifiedAt: expect.any(Number),
      })
    );
    expect(record.mock.calls[0]?.[3]?.visibleMs).toBeGreaterThanOrEqual(2_000);
  });

  it('não acumula permanência enquanto a aba está oculta', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    vi.spyOn(service, 'preparePhotoViewSession$').mockReturnValue(of(SESSION));
    const record = vi.spyOn(service, 'recordPhotoView$')
      .mockReturnValue(of(void 0));

    service.trackQualifiedPhotoView$(
      'owner-1',
      'photo-1',
      'profile'
    ).subscribe();

    vi.advanceTimersByTime(3_000);
    expect(record).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(2_200);

    expect(record).toHaveBeenCalledTimes(1);
  });
});
