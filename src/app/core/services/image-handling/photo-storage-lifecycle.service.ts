import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { deleteObject, ref } from 'firebase/storage';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { MediaApplicationErrorService } from '../media/media-application-error.service';
import type { MediaErrorReason } from '../media/media-error.catalog';

@Injectable({ providedIn: 'root' })
export class PhotoStorageLifecycleService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);

  private readonly mediaError = inject(MediaApplicationErrorService);

  extractOwnedPrivatePhotoPath(
    ownerUid: string,
    location: string
  ): string | null {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const safeLocation = String(location ?? '').trim();

    if (!safeOwnerUid || !safeLocation) {
      return null;
    }

    const directPath = this.normalizeOwnedPrivatePhotoPath(
      safeOwnerUid,
      safeLocation
    );

    if (directPath) {
      return directPath;
    }

    if (!/^https?:\/\//i.test(safeLocation)) {
      return null;
    }

    try {
      const parsedUrl = new URL(safeLocation);
      const objectMarker = '/o/';
      const objectIndex = parsedUrl.pathname.indexOf(objectMarker);

      if (objectIndex < 0) {
        return null;
      }

      const encodedPath = parsedUrl.pathname.slice(
        objectIndex + objectMarker.length
      );
      const decodedPath = decodeURIComponent(encodedPath);

      return this.normalizeOwnedPrivatePhotoPath(
        safeOwnerUid,
        decodedPath
      );
    } catch {
      return null;
    }
  }

  deleteOwnedPrivatePhoto$(
    ownerUid: string,
    storagePath: string
  ): Observable<void> {
    return defer(() => {
      const safeOwnerUid = String(ownerUid ?? '').trim();
      const currentUid = this.auth.currentUser?.uid?.trim() ?? '';
      const safePath = this.extractOwnedPrivatePhotoPath(
        safeOwnerUid,
        storagePath
      );

      if (!safeOwnerUid || currentUid !== safeOwnerUid) {
        throw this.createError(
          'photo_storage_owner_mismatch',
          'A foto só pode ser manipulada pelo perfil autenticado.'
        );
      }

      if (!safePath) {
        throw this.createError(
          'photo_storage_path_invalid',
          'A foto não possui um caminho privado válido.'
        );
      }

      return from(deleteObject(ref(this.storage, safePath))).pipe(
        map(() => void 0)
      );
    }).pipe(
      catchError((error) => {
        this.reportError(error, ownerUid, storagePath);
        return throwError(() => error);
      })
    );
  }

  private normalizeOwnedPrivatePhotoPath(
    ownerUid: string,
    path: string
  ): string | null {
    const safePath = String(path ?? '')
      .trim()
      .replace(/^\/+/, '');
    const escapedOwnerUid = ownerUid.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
    const expectedPath = new RegExp(
      `^users/${escapedOwnerUid}/uploads/images/[^/]+$`
    );

    return expectedPath.test(safePath) ? safePath : null;
  }

  private createError(reason: MediaErrorReason, message: string): Error {
    const error = new Error(message) as Error & {
      reason?: MediaErrorReason;
    };
    error.name = 'MediaError';
    error.reason = reason;
    return error;
  }

  private reportError(
    error: unknown,
    ownerUid: string,
    storagePath: string
  ): void {
    this.mediaError.reportSilently(
      error,
      'photoStorage.deleteOwnedPrivatePhoto',
      'Não foi possível excluir a foto agora.',
      {
        scope: 'PhotoStorageLifecycleService',
        hasOwnerUid: !!String(ownerUid ?? '').trim(),
        hasStoragePath: !!String(storagePath ?? '').trim(),
      },
      'photo_delete_failed'
    );
  }
}
