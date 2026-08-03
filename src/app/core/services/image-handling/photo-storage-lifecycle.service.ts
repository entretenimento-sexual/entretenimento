import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class PhotoStorageLifecycleService {
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

  /**
   * @deprecated A exclusão direta de uploads privados foi bloqueada nas
   * Storage Rules. Antes do registro, use o cancelamento da reserva; depois do
   * registro, use `deleteProfilePhoto` pelo serviço Firestore.
   */
  deleteOwnedPrivatePhoto$(
    ownerUid: string,
    storagePath: string
  ): Observable<never> {
    const error = this.createError(
      'media/direct-private-photo-delete-disabled',
      'A exclusão direta da foto privada foi desativada.'
    );

    this.reportError(error, ownerUid, storagePath);
    return throwError(() => error);
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
        deprecated: true,
      };
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // A telemetria não substitui o erro de domínio.
    }
  }
}
