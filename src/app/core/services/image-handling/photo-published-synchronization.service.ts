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

/** Can be tested without Firebase; stale publication events must not complete. */
export function awaitPublishedPhotoSync$(
  publications$: Observable<PhotoPublicationSyncRecord | null | undefined>,
  ownerUid: string,
  photoId: string,
  sourceStoragePath: string,
  timeoutMs = 45_000
): Observable<void> {
  return publications$.pipe(
    filter((publication) =>
      isPublishedPhotoReplacementConfirmed(
        ownerUid, photoId, sourceStoragePath, publication
      )
    ),
    take(1),
    timeout({ first: timeoutMs }),
    map(() => void 0)
  );
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
    const publications$ = this.context.deferObservable$(() => docData(doc(
      this.firestore,
      `users/${ownerUid}/photo_publications/${photoId}`
    )));
    // O timeout preserva o arquivo antigo; o processamento servidor pode ser
    // reconciliado sem entregar sucesso falso ao cliente.
    return awaitPublishedPhotoSync$(
      publications$,
      ownerUid,
      photoId,
      sourceStoragePath
    );
  }
}
