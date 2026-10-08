import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { BehaviorSubject, of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import { StorageService } from './storage.service';

const mockUpload = vi.hoisted(() => ({
  cancel: vi.fn(() => true),
  unsubscribe: vi.fn(),
  complete: null as (() => void) | null,
}));

vi.mock('firebase/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/storage')>();
  return {
    ...actual,
    ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
    uploadBytesResumable: vi.fn(() => ({
      cancel: mockUpload.cancel,
      on: vi.fn((_event: string, _progress: unknown, _error: unknown, complete: () => void) => {
        mockUpload.complete = complete;
        return mockUpload.unsubscribe;
      }),
    })),
  };
});

describe('StorageService / upload resumível e sessão', () => {
  let storageService: StorageService;
  let uid$: BehaviorSubject<string | null>;
  const report = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.complete = null;
    uid$ = new BehaviorSubject<string | null>('u1');
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
    storageService = TestBed.inject(StorageService);
  });

  function rawUpload$(): Observable<string> {
    const internal = storageService as unknown as {
      uploadResumablePath$: (path: string, file: File, kind: 'image') => Observable<string>;
    };
    return internal.uploadResumablePath$(
      'users/u1/uploads/images/file.jpg',
      new File(['image'], 'file.jpg', { type: 'image/jpeg' }),
      'image'
    );
  }

  it('ao desinscrever, cancela a transferência no Firebase e não apenas o listener', () => {
    const subscription = rawUpload$().subscribe();
    expect(mockUpload.cancel).not.toHaveBeenCalled();

    subscription.unsubscribe();

    expect(mockUpload.unsubscribe).toHaveBeenCalledOnce();
    expect(mockUpload.cancel).toHaveBeenCalledOnce();
  });

  it('após concluir, não tenta cancelar a transferência terminada', () => {
    const values: string[] = [];
    rawUpload$().subscribe((path) => values.push(path));

    expect(mockUpload.complete).toBeTypeOf('function');
    mockUpload.complete?.();

    expect(values).toEqual(['users/u1/uploads/images/file.jpg']);
    expect(mockUpload.unsubscribe).toHaveBeenCalledOnce();
    expect(mockUpload.cancel).not.toHaveBeenCalled();
  });

  it('troca de UID encerra upload ativo sem publicar sucesso nem exibir erro', () => {
    const internal = storageService as unknown as {
      validateImageFile: (file: File) => Observable<unknown>;
      reservePhotoUpload$: (uid: string, path: string, file: File) => Observable<string>;
    };
    vi.spyOn(internal, 'validateImageFile').mockReturnValue(of(void 0));
    vi.spyOn(internal, 'reservePhotoUpload$').mockReturnValue(of('reservation-1'));

    const successes: unknown[] = [];
    const complete = vi.fn();
    const path = 'users/u1/uploads/images/file.jpg';
    const subscription = storageService.uploadOwnedPhotoFile(
      new File(['image'], 'file.jpg', { type: 'image/jpeg' }),
      path,
      'u1'
    ).subscribe({ next: (value) => successes.push(value), complete });

    expect(mockUpload.cancel).not.toHaveBeenCalled();
    uid$.next('u2');

    expect(subscription.closed).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(mockUpload.cancel).toHaveBeenCalledOnce();
    expect(successes).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });
});
