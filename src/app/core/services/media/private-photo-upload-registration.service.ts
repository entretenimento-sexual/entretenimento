import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface RegisterPrivatePhotoUploadCommand {
  ownerUid: string;
  photoId: string;
  reservationId: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
}

export interface RegisterPrivatePhotoUploadResult {
  photoId: string;
  ownerUid: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
  draftExpiresAt: number;
}

export interface ReplacePrivatePhotoUploadCommand {
  ownerUid: string;
  photoId: string;
  reservationId: string;
  currentStoragePath: string;
  newStoragePath: string;
  newDisplayUrl: string;
  fileName: string;
  sizeBytes: number;
}

export interface ReplacePrivatePhotoUploadResult {
  photoId: string;
  ownerUid: string;
  previousStoragePath: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PrivatePhotoUploadRegistrationService {
  private readonly functions = inject(Functions);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly registerCallable = httpsCallable<
    RegisterPrivatePhotoUploadCommand,
    RegisterPrivatePhotoUploadResult
  >(this.functions, 'registerPrivatePhotoUpload');
  private readonly replaceCallable = httpsCallable<
    ReplacePrivatePhotoUploadCommand,
    ReplacePrivatePhotoUploadResult
  >(this.functions, 'replacePrivatePhotoUpload');

  register$(
    command: RegisterPrivatePhotoUploadCommand
  ): Observable<RegisterPrivatePhotoUploadResult> {
    return defer(() => from(this.registerCallable(command))).pipe(
      map((response) => response.data),
      catchError((error) => this.handleError$(error, {
        op: 'register$',
        hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
        hasPhotoId: !!String(command.photoId ?? '').trim(),
        hasReservationId: !!String(command.reservationId ?? '').trim(),
        sizeBytes: command.sizeBytes,
      }))
    );
  }

  replace$(
    command: ReplacePrivatePhotoUploadCommand
  ): Observable<ReplacePrivatePhotoUploadResult> {
    return defer(() => from(this.replaceCallable(command))).pipe(
      map((response) => response.data),
      catchError((error) => this.handleError$(error, {
        op: 'replace$',
        hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
        hasPhotoId: !!String(command.photoId ?? '').trim(),
        hasReservationId: !!String(command.reservationId ?? '').trim(),
        sizeBytes: command.sizeBytes,
      }))
    );
  }

  private handleError$<T>(
    error: unknown,
    context: Record<string, unknown>
  ): Observable<T> {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao registrar a foto privada.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PrivatePhotoUploadRegistrationService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // A telemetria não substitui o erro original.
    }

    return throwError(() => error);
  }
}
