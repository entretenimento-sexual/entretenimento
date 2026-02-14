// src/app/core/services/media/media-command.service.ts
// Commands do domínio Media (fotos/vídeos).
// MVP: upload simulado (Observable de progresso).
// Depois: plugar Storage + Firestore, mantendo assinatura.

import { Injectable } from '@angular/core';
import { Observable, interval, of } from 'rxjs';
import { catchError, map, takeWhile, tap } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaQueryService } from './media-query.service';
import type { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';

export type UploadPhase = 'UPLOADING' | 'DONE';

export interface IMediaUploadProgress {
  phase: UploadPhase;
  progress: number; // 0..100
  // Futuro:
  // photoId?: string;
  // downloadUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class MediaCommandService {
  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly mediaQuery: MediaQueryService
  ) { }

  /**
   * Upload de foto do perfil.
   * MVP: simulado; Futuro: Storage + doc em "media/photos".
   *
   * Mantive o nome do método.
   * Adicionei previewUrl opcional (não quebra chamada existente).
   */
  uploadProfilePhoto$(
    ownerUid: string,
    file: File,
    previewUrl?: string | null
  ): Observable<IMediaUploadProgress> {
    if (!ownerUid) {
      this.errorNotifier.showError('Perfil inválido para upload.');
      return of({ phase: 'DONE', progress: 0 });
    }

    if (!file?.type?.startsWith('image/')) {
      this.errorNotifier.showError('Arquivo inválido. Selecione uma imagem.');
      return of({ phase: 'DONE', progress: 0 });
    }

    // Item final (MVP): usa previewUrl se existir; senão, asset.
    const photo: IPhotoItem = {
      id: `p_${ownerUid}_${Date.now()}`,
      ownerUid,
      url: previewUrl ?? 'assets/imagem-padrao.webp',
      alt: file.name,
      createdAt: Date.now(),
    };

    return interval(120).pipe(
      map((tick) => Math.min(100, (tick + 1) * 5)),
      map((p) => ({ phase: p === 100 ? 'DONE' : 'UPLOADING', progress: p } as IMediaUploadProgress)),
      takeWhile((evt) => evt.progress < 100, true),
      tap((evt) => {
        if (evt.phase === 'DONE') {
          // ✅ atualiza UI imediatamente (store vivo)
          this.mediaQuery.appendProfilePhoto(ownerUid, photo);

          // ✅ mantém invalidate para quando virar Firestore
          this.mediaQuery.invalidateProfilePhotos(ownerUid);
        }
      }),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return of({ phase: 'DONE', progress: 0 } as IMediaUploadProgress);
      })
    );
  }

  /**
   * Delete (MVP).
   * Futuro: deletar Storage + remover doc Firestore + invalidar cache.
   */
  deleteProfilePhoto$(ownerUid: string, photoId: string): Observable<void> {
    if (!ownerUid || !photoId) return of(void 0);

    this.mediaQuery.removeProfilePhoto(ownerUid, photoId);
    this.mediaQuery.invalidateProfilePhotos(ownerUid);

    return of(void 0);
  }
}
