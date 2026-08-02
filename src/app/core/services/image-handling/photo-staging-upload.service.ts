import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import {
  getDownloadURL,
  ref,
  type UploadTask,
  uploadBytesResumable,
} from 'firebase/storage';
import { Observable, from } from 'rxjs';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

export type PhotoStagingSlot = 'source-a' | 'source-b';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

@Injectable({ providedIn: 'root' })
export class PhotoStagingUploadService {
  private readonly auth = inject(Auth);
  private readonly storage = inject(Storage);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  buildInitialPath(ownerUid: string, photoId: string): string {
    return this.buildPath(ownerUid, photoId, 'source-a');
  }

  buildReplacementPath(
    ownerUid: string,
    photoId: string,
    currentStoragePath: string
  ): string {
    const current = String(currentStoragePath ?? '').trim();
    const nextSlot: PhotoStagingSlot = current.endsWith('/source-a')
      ? 'source-b'
      : 'source-a';

    return this.buildPath(ownerUid, photoId, nextSlot);
  }

  upload$(
    ownerUid: string,
    photoId: string,
    file: File,
    storagePath: string,
    progressCallback?: (progress: number) => void
  ): Observable<string> {
    return new Observable<string>((observer) => {
      let task: UploadTask | null = null;

      try {
        this.assertOwner(ownerUid);
        this.assertPhotoId(photoId);
        this.assertFile(file);
        this.assertOwnedPath(ownerUid, photoId, storagePath);

        task = uploadBytesResumable(ref(this.storage, storagePath), file, {
          contentType: file.type,
          cacheControl: 'private, max-age=0, no-store, no-transform',
          customMetadata: {
            ownerUid,
            photoId,
            uploadPurpose: 'publication-staging',
          },
        });
      } catch (error) {
        this.report(error, {
          op: 'upload$.validate',
          hasOwnerUid: !!String(ownerUid ?? '').trim(),
          hasPhotoId: !!String(photoId ?? '').trim(),
          hasStoragePath: !!String(storagePath ?? '').trim(),
          hasFile: !!file,
        });
        observer.error(error);
        return undefined;
      }

      const unsubscribe = task.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes > 0
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0;
          progressCallback?.(this.normalizeProgress(progress));
        },
        (error) => {
          this.report(error, {
            op: 'upload$',
            hasOwnerUid: true,
            hasPhotoId: true,
            hasStoragePath: true,
            sizeBytes: file.size,
            mimeType: file.type,
          });
          observer.error(error);
        },
        () => {
          observer.next(storagePath);
          observer.complete();
        }
      );

      return () => {
        unsubscribe();
        task?.cancel();
      };
    });
  }

  resolveReadableUrl$(storagePath: string): Observable<string> {
    return from(getDownloadURL(ref(this.storage, storagePath)));
  }

  private buildPath(
    ownerUid: string,
    photoId: string,
    slot: PhotoStagingSlot
  ): string {
    const safeOwnerUid = this.normalizeId(ownerUid, 'UID inválido.');
    const safePhotoId = this.normalizeId(photoId, 'Foto inválida.');

    return `users/${safeOwnerUid}/uploads/images/${safePhotoId}/${slot}`;
  }

  private assertOwner(ownerUid: string): void {
    const safeOwnerUid = this.normalizeId(ownerUid, 'UID inválido.');
    const authenticatedUid = this.auth.currentUser?.uid?.trim() ?? '';

    if (!authenticatedUid || authenticatedUid !== safeOwnerUid) {
      throw this.createError(
        'media/photo-upload-owner-mismatch',
        'O upload deve ocorrer no perfil autenticado.'
      );
    }
  }

  private assertPhotoId(photoId: string): void {
    this.normalizeId(photoId, 'Foto inválida para upload.');
  }

  private assertFile(file: File): void {
    if (!file) {
      throw this.createError(
        'media/photo-upload-file-missing',
        'Selecione uma foto antes de enviar.'
      );
    }

    const mimeType = String(file.type ?? '').trim().toLowerCase();

    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw this.createError(
        'media/photo-upload-format-invalid',
        'Envie uma foto JPG, PNG ou WEBP.'
      );
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw this.createError(
        'media/photo-upload-empty',
        'A foto selecionada está vazia.'
      );
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw this.createError(
        'media/photo-upload-too-large',
        'A foto excede o limite de 10 MB.'
      );
    }
  }

  private assertOwnedPath(
    ownerUid: string,
    photoId: string,
    storagePath: string
  ): void {
    const escapedOwnerUid = ownerUid.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
    const escapedPhotoId = photoId.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
    const pattern = new RegExp(
      `^users/${escapedOwnerUid}/uploads/images/${escapedPhotoId}/(?:source-a|source-b)$`
    );

    if (!pattern.test(String(storagePath ?? '').trim())) {
      throw this.createError(
        'media/photo-upload-path-invalid',
        'O caminho de upload da foto é inválido.'
      );
    }
  }

  private normalizeId(value: string, message: string): string {
    const normalized = String(value ?? '').trim();

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
      throw this.createError('media/photo-upload-id-invalid', message);
    }

    return normalized;
  }

  private normalizeProgress(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private report(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no staging da foto.');
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PhotoStagingUploadService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // A telemetria não pode interromper o upload.
    }
  }
}
