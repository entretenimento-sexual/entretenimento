import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, throwError } from 'rxjs';
import { filter, map, switchMap, take, takeUntil } from 'rxjs/operators';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { StorageService } from './storage.service';
import { validateImageMediaFile } from '../media/media-format.policy';

export interface PublishedPhotoReplacementCommand {
  readonly ownerUid: string;
  readonly photoId: string;
  readonly expectedAssetVersion: number;
  readonly processedFile: File;
}

interface ReplacePublishedPhotoResponse {
  photoId: string;
  assetVersion: number;
  replaced: boolean;
}

/**
 * Publicações sociais são autoridade; não depende de users/{uid}/photos.
 * A captura nativa e o editor local produzem o mesmo File.
 */
@Injectable({ providedIn: 'root' })
export class PublishedPhotoReplacementService {
  private readonly storage = inject(StorageService);
  private readonly functions = inject(Functions);
  private readonly auth = inject(AuthSessionService);
  private readonly context = inject(FirestoreContextService);

  replace$(command: PublishedPhotoReplacementCommand): Observable<void> {
    return defer(() => {
      const ownerUid = String(command.ownerUid ?? '').trim();
      const photoId = String(command.photoId ?? '').trim();
      const version = Number(command.expectedAssetVersion);
      const file = command.processedFile;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(photoId) ||
          !Number.isSafeInteger(version) || version <= 0 ||
          !validateImageMediaFile(file).valid) {
        return throwError(() =>
          new Error('Arquivo ou publicação inválidos para substituição.'));
      }
      return this.auth.uid$.pipe(
        take(1),
        switchMap((uid) => {
          if (uid !== ownerUid) {
            return throwError(() => new Error('Sessão diferente do proprietário.'));
          }
          const storagePath = this.storage.buildOwnedImageUploadPath(
            ownerUid, file.name
          );
          return this.storage.uploadOwnedPhotoFile(
            file, storagePath, ownerUid
          ).pipe(
            switchMap((upload) => this.context.deferPromise$(() => {
              const callable = httpsCallable<
                {
                  ownerUid: string; photoId: string;
                  sourceStoragePath: string; reservationId: string;
                  expectedAssetVersion: number;
                },
                ReplacePublishedPhotoResponse
              >(this.functions, 'replacePublishedPhoto');
              return callable({
                ownerUid,
                photoId,
                sourceStoragePath: upload.storagePath,
                reservationId: upload.reservationId,
                expectedAssetVersion: version,
              });
            })),
            map(({ data }) => {
              if (!data?.replaced || data.photoId !== photoId ||
                  !Number.isSafeInteger(data.assetVersion)) {
                throw new Error('A publicação final não foi confirmada.');
              }
              return void 0;
            })
          );
        }),
        takeUntil(this.auth.uid$.pipe(filter((uid) => uid !== ownerUid)))
      );
    });
  }
}
