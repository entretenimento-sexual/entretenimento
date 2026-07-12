import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { deleteObject, ref } from 'firebase/storage';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class PhotoStorageLifecycleService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);

  constructor(
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

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
          'media/storage-owner-mismatch',
          'A foto só pode ser manipulada pelo perfil autenticado.'
        );
      }

      if (!safePath) {
        throw this.createError(
          'media/invalid-storage-path',
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

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private reportError(
    error: unknown,
    ownerUid: string,
    storagePath: string
  ): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error('[PhotoStorageLifecycleService] Falha no ciclo da foto.');

      (reportable as any).context = 'PhotoStorageLifecycleService';
      (reportable as any).operation = 'deleteOwnedPrivatePhoto';
      (reportable as any).extra = {
        hasOwnerUid: !!String(ownerUid ?? '').trim(),
        hasStoragePath: !!String(storagePath ?? '').trim(),
      };
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // noop
    }
  }
}
