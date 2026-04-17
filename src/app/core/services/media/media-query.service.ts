// src/app/core/services/media/media-query.service.ts
// Query real do domínio Media (fotos).
//
// AJUSTES DESTA VERSÃO:
// - continua sem store fake
// - continua lendo do PhotoFirestoreService
// - agora expõe path e fileName para gestão direta na galeria
// - mantém stream reativa e contrato de leitura

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  Photo,
  PhotoFirestoreService,
} from 'src/app/core/services/image-handling/photo-firestore.service';
import type { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';

@Injectable({ providedIn: 'root' })
export class MediaQueryService {
  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly photoFirestoreService: PhotoFirestoreService
  ) {}

  getProfilePhotos$(ownerUid: string): Observable<IPhotoItem[]> {
    return this.watchProfilePhotos$(ownerUid);
  }

  watchProfilePhotos$(ownerUid: string): Observable<IPhotoItem[]> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    if (!safeOwnerUid) {
      return of([]);
    }

    return this.photoFirestoreService.getPhotosByUser(safeOwnerUid).pipe(
      map((items) => items.map((photo) => this.mapPhotoToMediaItem(safeOwnerUid, photo))),
      distinctUntilChanged((a, b) => this.sameItems(a, b)),
      catchError(() => {
        this.errorNotifier.showError('Erro ao carregar fotos do perfil.');
        return of([] as IPhotoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private mapPhotoToMediaItem(ownerUid: string, photo: Photo): IPhotoItem {
    return {
      id: photo.id,
      ownerUid,
      url: photo.url,
      alt: photo.fileName || 'Foto do perfil',
      createdAt: this.normalizeCreatedAt(photo.createdAt),
      path: photo.path,
      fileName: photo.fileName,
    };
  }

  private normalizeCreatedAt(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate?: unknown }).toDate === 'function'
    ) {
      try {
        const date = (value as { toDate: () => Date }).toDate();
        return date.getTime();
      } catch {
        return Date.now();
      }
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'seconds' in value &&
      typeof (value as { seconds?: unknown }).seconds === 'number'
    ) {
      return Number((value as { seconds: number }).seconds) * 1000;
    }

    return Date.now();
  }

  private sameItems(a: IPhotoItem[], b: IPhotoItem[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;

    return a.every((item, index) => {
      const other = b[index];
      return (
        item?.id === other?.id &&
        item?.url === other?.url &&
        item?.createdAt === other?.createdAt &&
        item?.path === other?.path &&
        item?.fileName === other?.fileName
      );
    });
  }
}