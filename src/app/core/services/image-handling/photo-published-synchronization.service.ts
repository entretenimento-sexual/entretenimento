import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { filter, map, take, timeout } from 'rxjs/operators';

import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

interface PhotoPublicationSyncRecord {
  isPublished?: unknown;
  sourceStoragePath?: unknown;
  publishedStoragePath?: unknown;
}

/**
 * Confirma a troca efetiva do arquivo publicado. Registrar o upload privado
 * nao significa que a Function assincrona concluiu a sanitizacao e o commit.
 * Nao cria versões, documentos nem cópias físicas.
 */
export function isPublishedPhotoReplacementConfirmed(
  ownerUid: string,
  photoId: string,
  expectedSourceStoragePath: string,
  record: PhotoPublicationSyncRecord | null | undefined
): boolean {
  const expectedSource = String(expectedSourceStoragePath ?? '').trim();
  const publishedPath = String(record?.publishedStoragePath ?? '').trim();
  const owner = String(ownerUid ?? '').trim();
  const photo = String(photoId ?? '').trim();
  if (!owner || !photo || !expectedSource ||
      owner.includes('/') || photo.includes('/') ||
      !expectedSource.startsWith(`users/${owner}/uploads/images/`) ||
      expectedSource.slice(`users/${owner}/uploads/images/`.length).includes('/')) {
    return false;
  }
  const expectedPrefix = `users/${owner}/published/images/${photo}/`;
  return record?.isPublished === true &&
    record.sourceStoragePath === expectedSource &&
    publishedPath.startsWith(expectedPrefix) &&
    publishedPath.length > expectedPrefix.length &&
    !publishedPath.slice(expectedPrefix.length).includes('/');
}

@Injectable({ providedIn: 'root' })
export class PhotoPublishedSynchronizationService {
  private readonly firestore = inject(Firestore);
  private readonly context = inject(FirestoreContextService);

  waitForPublishedReplacement$(
    ownerUid: string,
    photoId: string,
    sourceStoragePath: string
  ): Observable<void> {
    return this.context.deferObservable$(() => docData(doc(
      this.firestore,
      `users/${ownerUid}/photo_publications/${photoId}`
    ))).pipe(
      filter((publication) =>
        isPublishedPhotoReplacementConfirmed(
          ownerUid,
          photoId,
          sourceStoragePath,
          publication as PhotoPublicationSyncRecord | undefined
        )
      ),
      take(1),
      // A origem anterior nao deve ser descartada se a Function demorar ou
      // falhar. O retry administrativo pode terminar a copia posteriormente.
      timeout({ first: 45_000 }),
      map(() => void 0)
    );
  }
}
