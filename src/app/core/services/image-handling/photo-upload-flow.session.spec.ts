import { BehaviorSubject, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PhotoFirestoreService } from './photo-firestore.service';
import { PhotoStorageLifecycleService } from './photo-storage-lifecycle.service';
import { PhotoUploadFlowService, type IPhotoUploadFlowEvent } from './photo-upload-flow.service';
import { StorageService, type PhotoUploadAssetResult } from './storage.service';

function harness() {
  const uid$ = new BehaviorSubject<string | null>('owner-a');
  const pendingUpload$ = new Subject<PhotoUploadAssetResult>();
  const storage = {
    buildOwnedImageUploadPath: vi.fn(() => 'users/owner-a/uploads/images/file.jpg'),
    uploadOwnedPhotoFile: vi.fn(() => pendingUpload$.asObservable()),
    getPhotoUrl: vi.fn(() => of('https://example.test/photo.jpg')),
  };
  const firestore = {
    savePhotoMetadata: vi.fn(() => Promise.resolve()),
    updatePhotoMetadata: vi.fn(() => Promise.resolve()),
    saveImageState: vi.fn(() => Promise.resolve()),
  };
  const lifecycle = {
    extractOwnedPrivatePhotoPath: vi.fn((_uid: string, path: string) => path),
    deleteOwnedPrivatePhoto$: vi.fn(() => of(void 0)),
  };
  const errors = { report: vi.fn(), reportSilently: vi.fn() };
  const flow = new PhotoUploadFlowService(
    storage as unknown as StorageService,
    firestore as unknown as PhotoFirestoreService,
    lifecycle as unknown as PhotoStorageLifecycleService,
    errors as unknown as MediaApplicationErrorService,
    { uid$: uid$.asObservable() } as AuthSessionService
  );
  return { flow, uid$, pendingUpload$, storage, firestore, lifecycle, errors };
}

const command = () => ({
  userId: 'owner-a',
  processedFile: new Blob(['photo'], { type: 'image/jpeg' }),
  originalFileName: 'sample.jpg',
  mimeType: 'image/jpeg',
});

describe('PhotoUploadFlowService / sessão operacional', () => {
  it('encerra progresso e não grava metadados depois de A→B', () => {
    const h = harness();
    const events: IPhotoUploadFlowEvent[] = [];
    const complete = vi.fn();
    const sub = h.flow.uploadProcessedPhotoWithProgress$(command()).subscribe({
      next: (event) => events.push(event),
      complete,
    });

    expect(h.storage.uploadOwnedPhotoFile).toHaveBeenCalledOnce();
    h.uid$.next('owner-b');
    expect(complete).toHaveBeenCalledOnce();
    expect(sub.closed).toBe(true);

    h.pendingUpload$.next({
      storagePath: 'users/owner-a/uploads/images/file.jpg',
      reservationId: 'reservation-a',
      location: 'https://example.test/photo.jpg',
    });
    h.pendingUpload$.complete();

    expect(events.some((event) => event.type === 'success')).toBe(false);
    expect(h.firestore.savePhotoMetadata).not.toHaveBeenCalled();
    expect(h.errors.report).not.toHaveBeenCalled();
  });

  it('não inicia upload de A caso a sessão já esteja B', () => {
    const h = harness();
    h.uid$.next('owner-b');
    const complete = vi.fn();
    h.flow.uploadProcessedPhotoWithProgress$(command()).subscribe({ complete });

    expect(complete).toHaveBeenCalledOnce();
    expect(h.storage.uploadOwnedPhotoFile).not.toHaveBeenCalled();
    expect(h.firestore.savePhotoMetadata).not.toHaveBeenCalled();
  });

  it('transição A→B→A cancela irreversivelmente o upload antigo de A', () => {
    const h = harness();
    const events: IPhotoUploadFlowEvent[] = [];
    const sub = h.flow.uploadProcessedPhotoWithProgress$(command())
      .subscribe((event) => events.push(event));

    h.uid$.next('owner-b');
    h.uid$.next('owner-a');
    h.pendingUpload$.next({
      storagePath: 'users/owner-a/uploads/images/file.jpg',
      reservationId: 'reservation-a',
      location: 'https://example.test/photo.jpg',
    });
    expect(sub.closed).toBe(true);
    expect(h.firestore.savePhotoMetadata).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'success')).toBe(false);
  });
});
