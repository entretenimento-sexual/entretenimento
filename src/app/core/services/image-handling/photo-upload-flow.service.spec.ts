import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PhotoUploadFlowService } from './photo-upload-flow.service';

function buildPublicationConfig(overrides: Record<string, unknown> = {}) {
  return {
    photoId: 'photo-1',
    ownerUid: 'user-1',
    isPublished: false,
    visibility: 'PRIVATE',
    caption: null,
    isCover: false,
    orderIndex: 0,
    commentsEnabled: true,
    commentsPolicy: 'EVERYONE',
    commentsCount: 0,
    reactionsEnabled: true,
    reactionsCount: 0,
    moderationStatus: 'PRIVATE',
    moderationReason: null,
    reportsCount: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    publishedAt: null,
    updatedAt: Date.now(),
    lastModeratedAt: null,
    ...overrides,
  };
}

function createFixture() {
  const storageService = {
    buildOwnedImageUploadPath: vi.fn(
      (uid: string, fileName: string) =>
        `users/${uid}/uploads/images/${fileName}`
    ),
    getPhotoUrl: vi.fn((path: string) =>
      of(`https://storage.test/o/${encodeURIComponent(path)}?token=1`)
    ),
  };
  const photoFirestoreService = {
    saveImageState: vi.fn(async () => undefined),
  };
  const photoStorageLifecycle = {
    extractOwnedPrivatePhotoPath: vi.fn(
      (_uid: string, location: string) => {
        if (location.startsWith('users/')) {
          return location;
        }

        const marker = '/o/';
        const index = location.indexOf(marker);
        return index >= 0
          ? decodeURIComponent(
            location.slice(index + marker.length).split('?')[0]
          )
          : null;
      }
    ),
  };
  const draftCapacity = {
    reserveUpload$: vi.fn((command: any) => of({
      reservationId: 'reservation-1',
      mediaId: command.mediaId,
      kind: 'photo',
      operation: command.operation,
      plan: 'free',
      expiresAt: Date.now() + 60_000,
      draftExpiresAt: Date.now() + 86_400_000,
      reservedBytes: command.sourceSizeBytes,
    })),
    cancelUploadReservation$: vi.fn(() => of(true)),
  };
  const reservedUpload = {
    upload$: vi.fn((
      path: string,
      _data: Blob,
      _contentType: string,
      _reservationId: string,
      _onProgress?: (progress: number) => void,
      _registerTask?: (task: unknown) => void
    ) => of({
      storagePath: path,
      displayLocation:
        `https://storage.test/o/${encodeURIComponent(path)}?token=1`,
    })),
  };
  const photoRegistration = {
    register$: vi.fn((command: any) => of({
      photoId: command.photoId,
      ownerUid: command.ownerUid,
      storagePath: command.storagePath,
      displayUrl: command.displayUrl,
      fileName: command.fileName,
      sizeBytes: command.sizeBytes,
      createdAt: command.createdAt,
      draftExpiresAt: Date.now() + 86_400_000,
    })),
    replace$: vi.fn((command: any) => of({
      photoId: command.photoId,
      ownerUid: command.ownerUid,
      previousStoragePath: command.currentStoragePath,
      storagePath: command.newStoragePath,
      displayUrl: command.newDisplayUrl,
      fileName: command.fileName,
      sizeBytes: command.sizeBytes,
      updatedAt: Date.now(),
    })),
  };
  const mediaPublication = {
    getPublicationConfigsByOwner$: vi.fn(() => of({})),
    buildDefaultConfig: vi.fn((ownerUid: string, photoId: string) =>
      buildPublicationConfig({ ownerUid, photoId })
    ),
    publishPhoto$: vi.fn((_command: any) => of(void 0)),
  };
  const errorHandler = {
    handleError: vi.fn(),
  };
  const errorNotifier = {
    showError: vi.fn(),
  };
  const service = new PhotoUploadFlowService(
    storageService as any,
    photoFirestoreService as any,
    photoStorageLifecycle as any,
    draftCapacity as any,
    reservedUpload as any,
    photoRegistration as any,
    mediaPublication as any,
    errorHandler as any,
    errorNotifier as any
  );

  return {
    service,
    storageService,
    photoFirestoreService,
    photoStorageLifecycle,
    draftCapacity,
    reservedUpload,
    photoRegistration,
    mediaPublication,
    errorHandler,
    errorNotifier,
  };
}

describe('PhotoUploadFlowService', () => {
  it('reserva, envia, registra e publica a criação com a mesma identidade', async () => {
    const fixture = createFixture();
    const result = await firstValueFrom(
      fixture.service.uploadProcessedPhoto$({
        userId: 'user-1',
        processedFile: new Blob(['photo'], { type: 'image/jpeg' }),
        originalFileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        imageStateStr: '{"zoom":1}',
      })
    );

    const reservation = fixture.draftCapacity.reserveUpload$.mock.calls[0][0];
    const upload = fixture.reservedUpload.upload$.mock.calls[0];
    const registration = fixture.photoRegistration.register$.mock.calls[0][0];
    const publication = fixture.mediaPublication.publishPhoto$.mock.calls[0][0];

    expect(reservation).toMatchObject({
      ownerUid: 'user-1',
      kind: 'photo',
      operation: 'CREATE',
      sourceSizeBytes: 5,
    });
    expect(upload[0]).toBe(reservation.sourceStoragePath);
    expect(upload[3]).toBe('reservation-1');
    expect(registration).toMatchObject({
      ownerUid: 'user-1',
      photoId: reservation.mediaId,
      reservationId: 'reservation-1',
      storagePath: reservation.sourceStoragePath,
      sizeBytes: 5,
    });
    expect(publication).toMatchObject({
      ownerUid: 'user-1',
      visibility: 'PUBLIC',
      commentsEnabled: true,
      commentsPolicy: 'EVERYONE',
      reactionsEnabled: true,
      photo: {
        id: reservation.mediaId,
        path: reservation.sourceStoragePath,
      },
    });
    expect(result.photoId).toBe(reservation.mediaId);
    expect(result.path).toBe(reservation.sourceStoragePath);
    expect(fixture.photoFirestoreService.saveImageState)
      .toHaveBeenCalledOnce();
    expect(
      fixture.draftCapacity.reserveUpload$.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.reservedUpload.upload$.mock.invocationCallOrder[0]
    );
    expect(
      fixture.reservedUpload.upload$.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.photoRegistration.register$.mock.invocationCallOrder[0]
    );
    expect(
      fixture.photoRegistration.register$.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.mediaPublication.publishPhoto$.mock.invocationCallOrder[0]
    );
  });

  it('preserva capa, ordem e interações ao publicar a substituição', async () => {
    const fixture = createFixture();
    const currentPath = 'users/user-1/uploads/images/current.jpg';
    fixture.mediaPublication.getPublicationConfigsByOwner$.mockReturnValue(
      of({
        'photo-1': buildPublicationConfig({
          photoId: 'photo-1',
          isPublished: true,
          visibility: 'PUBLIC',
          isCover: true,
          orderIndex: 3,
          commentsEnabled: false,
          commentsPolicy: 'OFF',
          reactionsEnabled: false,
          moderationStatus: 'APPROVED',
        }),
      })
    );

    const result = await firstValueFrom(
      fixture.service.replaceProcessedPhoto$({
        userId: 'user-1',
        photoId: 'photo-1',
        currentStoragePath: currentPath,
        processedFile: new Blob(['replacement'], { type: 'image/jpeg' }),
        originalFileName: 'replacement.jpg',
        mimeType: 'image/jpeg',
      })
    );

    const reservation = fixture.draftCapacity.reserveUpload$.mock.calls[0][0];
    const registration = fixture.photoRegistration.replace$.mock.calls[0][0];
    const publication = fixture.mediaPublication.publishPhoto$.mock.calls[0][0];

    expect(reservation).toMatchObject({
      ownerUid: 'user-1',
      mediaId: 'photo-1',
      kind: 'photo',
      operation: 'REPLACE',
      currentStoragePath: currentPath,
    });
    expect(registration).toMatchObject({
      ownerUid: 'user-1',
      photoId: 'photo-1',
      reservationId: 'reservation-1',
      currentStoragePath: currentPath,
      newStoragePath: reservation.sourceStoragePath,
    });
    expect(publication).toMatchObject({
      ownerUid: 'user-1',
      isCover: true,
      orderIndex: 3,
      commentsEnabled: false,
      commentsPolicy: 'EVERYONE',
      reactionsEnabled: false,
    });
    expect(result.path).toBe(reservation.sourceStoragePath);
    expect(fixture.draftCapacity.cancelUploadReservation$)
      .not.toHaveBeenCalled();
  });

  it('cancela a reserva ao interromper antes do registro', async () => {
    const fixture = createFixture();
    let notifyUploadSubscribed!: () => void;
    const uploadSubscribed = new Promise<void>((resolve) => {
      notifyUploadSubscribed = resolve;
    });

    fixture.reservedUpload.upload$.mockImplementation(() =>
      new Observable(() => {
        notifyUploadSubscribed();
        return () => undefined;
      })
    );

    const subscription = fixture.service.uploadProcessedPhoto$({
      userId: 'user-1',
      processedFile: new Blob(['photo'], { type: 'image/jpeg' }),
      originalFileName: 'photo.jpg',
      mimeType: 'image/jpeg',
    }).subscribe();

    await uploadSubscribed;
    subscription.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.draftCapacity.cancelUploadReservation$)
      .toHaveBeenCalledWith('reservation-1');
    expect(fixture.photoRegistration.register$).not.toHaveBeenCalled();
    expect(fixture.mediaPublication.publishPhoto$).not.toHaveBeenCalled();
  });

  it('não cancela nem apaga após o início do registro', async () => {
    const fixture = createFixture();
    fixture.photoRegistration.register$.mockReturnValue(
      throwError(() => Object.assign(
        new Error('Resposta indisponível.'),
        { code: 'functions/unavailable' }
      ))
    );

    await expect(firstValueFrom(
      fixture.service.uploadProcessedPhoto$({
        userId: 'user-1',
        processedFile: new Blob(['photo'], { type: 'image/jpeg' }),
        originalFileName: 'photo.jpg',
        mimeType: 'image/jpeg',
      })
    )).rejects.toThrow('Resposta indisponível.');

    expect(fixture.photoRegistration.register$).toHaveBeenCalledOnce();
    expect(fixture.mediaPublication.publishPhoto$).not.toHaveBeenCalled();
    expect(fixture.draftCapacity.cancelUploadReservation$)
      .not.toHaveBeenCalled();
    expect(fixture.errorNotifier.showError).toHaveBeenCalledOnce();
  });

  it('não executa rollback do cliente quando a publicação falha após o registro', async () => {
    const fixture = createFixture();
    fixture.mediaPublication.publishPhoto$.mockReturnValue(
      throwError(() => Object.assign(
        new Error('Publicação temporariamente indisponível.'),
        { code: 'functions/failed-precondition' }
      ))
    );

    await expect(firstValueFrom(
      fixture.service.uploadProcessedPhoto$({
        userId: 'user-1',
        processedFile: new Blob(['photo'], { type: 'image/jpeg' }),
        originalFileName: 'photo.jpg',
        mimeType: 'image/jpeg',
      })
    )).rejects.toThrow('Publicação temporariamente indisponível.');

    expect(fixture.photoRegistration.register$).toHaveBeenCalledOnce();
    expect(fixture.mediaPublication.publishPhoto$).toHaveBeenCalledOnce();
    expect(fixture.draftCapacity.cancelUploadReservation$)
      .not.toHaveBeenCalled();
  });
});
