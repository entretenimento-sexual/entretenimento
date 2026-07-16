// src/app/core/services/media/media-query.service.ts
// Query real do domínio Media (fotos).
//
// AJUSTES DESTA VERSÃO:
// - continua sem store fake
// - continua lendo do PhotoFirestoreService
// - expõe path, fileName e displayDate para gestão direta na galeria
// - mantém stream reativa e contrato de leitura
// - datas ausentes/corrompidas permanecem desconhecidas, sem Date.now artificial

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs/operators';

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
      map((items) =>
        items.map((photo) =>
          this.mapPhotoToMediaItem(safeOwnerUid, photo)
        )
      ),
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
      displayDate: this.normalizeOptionalDateMs(photo.displayDate),
      path: photo.path,
      fileName: photo.fileName,
    };
  }

  /**
   * SUPRESSÃO EXPLÍCITA:
   * - removido o fallback Date.now() para data ausente ou inválida.
   *
   * Motivo:
   * - um horário inventado altera ordenação e faz mídia antiga parecer nova;
   * - zero preserva o contrato numérico e representa data desconhecida.
   */
  private normalizeCreatedAt(value: unknown): number {
    return this.normalizeDateMs(value) ?? 0;
  }

  private normalizeOptionalDateMs(value: unknown): number | null {
    return this.normalizeDateMs(value);
  }

  private normalizeDateMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }

    if (value instanceof Date) {
      const dateMs = value.getTime();
      return Number.isFinite(dateMs) && dateMs > 0 ? Math.trunc(dateMs) : null;
    }

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const timestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: unknown;
    };

    if (typeof timestamp.toMillis === 'function') {
      try {
        const millis = timestamp.toMillis();
        return Number.isFinite(millis) && millis > 0
          ? Math.trunc(millis)
          : null;
      } catch {
        return null;
      }
    }

    if (typeof timestamp.toDate === 'function') {
      try {
        const millis = timestamp.toDate().getTime();
        return Number.isFinite(millis) && millis > 0
          ? Math.trunc(millis)
          : null;
      } catch {
        return null;
      }
    }

    if (
      typeof timestamp.seconds === 'number' &&
      Number.isFinite(timestamp.seconds) &&
      timestamp.seconds > 0
    ) {
      return Math.trunc(timestamp.seconds * 1000);
    }

    return null;
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
        item?.displayDate === other?.displayDate &&
        item?.path === other?.path &&
        item?.fileName === other?.fileName
      );
    });
  }
}
