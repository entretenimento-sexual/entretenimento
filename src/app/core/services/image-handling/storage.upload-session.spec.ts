import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import type { UploadTask } from 'firebase/storage';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import { StorageService, observeStorageUploadTask$ } from './storage.service';

function fakeTask() {
  const cancel = vi.fn(() => true);
  const unsubscribe = vi.fn();
  let progress: ((snapshot: { bytesTransferred: number; totalBytes: number }) => void) | null = null;
  let success: (() => void) | null = null;
  const task = {
    cancel,
    on: vi.fn((_state, onProgress, _onError, onSuccess) => {
      progress = onProgress;
      success = onSuccess;
      return unsubscribe;
    }),
  } as unknown as Pick<UploadTask, 'on' | 'cancel'>;
  return {
    task, cancel, unsubscribe,
    complete: () => success?.(),
    progress: () => progress?.({ bytesTransferred: 1, totalBytes: 2 }),
  };
}

describe('StorageService / upload resumível e sessão', () => {
  it('unsubscribe cancela efetivamente a transferência Firebase pendente', () => {
    const h = fakeTask();
    const progress = vi.fn();
    const sub = observeStorageUploadTask$(h.task, 'users/u1/upload.jpg', progress).subscribe();
    h.progress();
    expect(progress).toHaveBeenCalledWith(50);

    sub.unsubscribe();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('conclusão normal não tenta cancelar transferência encerrada', () => {
    const h = fakeTask();
    const values: string[] = [];
    observeStorageUploadTask$(h.task, 'users/u1/upload.jpg').subscribe((value) => values.push(value));
    h.complete();

    expect(values).toEqual(['users/u1/upload.jpg']);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('troca de UID cancela a operação sem entregar sucesso ou erro ao usuário', () => {
    const uid$ = new BehaviorSubject<string | null>('u1');
    const report = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        StorageService,
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
        { provide: AuthSessionService, useValue: {
          uid$: uid$.asObservable(),
          isTerminatingSnapshot: false,
        } },
        { provide: Storage, useValue: {} },
        { provide: Functions, useValue: {} },
        { provide: FirestoreContextService, useValue: {} },
        { provide: ErrorNotificationService, useValue: {} },
        { provide: MediaApplicationErrorService, useValue: { report } },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
      ],
    });
    const service = TestBed.inject(StorageService);
    const internal = service as unknown as {
      validateImageFile: (file: File) => Observable<unknown>;
      reservePhotoUpload$: (uid: string, path: string, file: File) => Observable<string>;
      uploadResumablePath$: (path: string, file: File, kind: string) => Observable<string>;
    };
    vi.spyOn(internal, 'validateImageFile').mockReturnValue(of(void 0));
    vi.spyOn(internal, 'reservePhotoUpload$').mockReturnValue(of('reservation-1'));
    const cancelled = vi.fn();
    vi.spyOn(internal, 'uploadResumablePath$').mockImplementation(() =>
      new Observable<string>(() => cancelled)
    );
    const success = vi.fn();
    const complete = vi.fn();
    const sub = service.uploadOwnedPhotoFile(
      new File(['image'], 'file.jpg', { type: 'image/jpeg' }),
      'users/u1/uploads/images/file.jpg',
      'u1'
    ).subscribe({ next: success, complete });

    uid$.next('u2');
    expect(sub.closed).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
