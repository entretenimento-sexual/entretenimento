import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { PhotoStorageLifecycleService } from './photo-storage-lifecycle.service';

describe('PhotoStorageLifecycleService', () => {
  let service: PhotoStorageLifecycleService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PhotoStorageLifecycleService,
        {
          provide: Storage,
          useValue: {},
        },
        {
          provide: Auth,
          useValue: {
            currentUser: { uid: 'user-1' },
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(PhotoStorageLifecycleService);
  });

  it('mantém um storagePath privado pertencente ao usuário', () => {
    expect(
      service.extractOwnedPrivatePhotoPath(
        'user-1',
        'users/user-1/uploads/images/media-1.jpg'
      )
    ).toBe('users/user-1/uploads/images/media-1.jpg');
  });

  it('recupera o storagePath real de uma URL de download do Firebase', () => {
    const url =
      'https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/' +
      'users%2Fuser-1%2Fuploads%2Fimages%2Fmedia-2.webp?alt=media&token=abc';

    expect(
      service.extractOwnedPrivatePhotoPath('user-1', url)
    ).toBe('users/user-1/uploads/images/media-2.webp');
  });

  it('rejeita caminho pertencente a outro usuário', () => {
    expect(
      service.extractOwnedPrivatePhotoPath(
        'user-1',
        'users/user-2/uploads/images/media-3.jpg'
      )
    ).toBeNull();
  });

  it('rejeita namespaces publicados ou arbitrários', () => {
    expect(
      service.extractOwnedPrivatePhotoPath(
        'user-1',
        'users/user-1/published/images/media-4.jpg'
      )
    ).toBeNull();

    expect(
      service.extractOwnedPrivatePhotoPath(
        'user-1',
        'system/media-5.jpg'
      )
    ).toBeNull();
  });
});
