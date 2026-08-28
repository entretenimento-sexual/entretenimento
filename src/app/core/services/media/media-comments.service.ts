// src\app\core\services\media\media-comments.service.ts
// Serviço de comentários do domínio Media.
//
// AJUSTES DESTA VERSÃO:
// - deixa de ser vazio
// - reaproveita PhotoFirestoreService real
// - mantém owner-only implícito pelas regras atuais do Firestore
// - expõe leitura reativa e criação de comentário
// - normaliza/sanitiza comentário antes de enviar
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  PhotoComment,
  PhotoFirestoreService,
} from 'src/app/core/services/image-handling/photo-firestore.service';

@Injectable({ providedIn: 'root' })
export class MediaCommentsService {
  constructor(
    private readonly photoFirestoreService: PhotoFirestoreService
  ) {}

  getPhotoComments$(ownerUid: string, photoId: string): Observable<PhotoComment[]> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of([]);
    }

    return this.photoFirestoreService.getComments(safeOwnerUid, safePhotoId).pipe(
      map((comments) => [...comments].sort((a, b) => this.toMillis(b.date) - this.toMillis(a.date)))
    );
  }

  addPhotoComment$(ownerUid: string, photoId: string, comment: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();
    const safeComment = this.normalizeComment(comment);

    if (!safeOwnerUid || !safePhotoId || !safeComment) {
      return of(void 0);
    }

    return from(
      this.photoFirestoreService.addComment(safeOwnerUid, safePhotoId, safeComment)
    ).pipe(
      map(() => void 0)
    );
  }

  private normalizeComment(value: string): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
  }

  private toMillis(value: unknown): number {
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
        return (value as { toDate: () => Date }).toDate().getTime();
      } catch {
        return 0;
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

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    return 0;
  }
}