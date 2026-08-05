import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';

import {
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

export type PublicPhotoRankingMode = 'latest' | 'top' | 'boosted';

interface AuthorizedProfilePhotosRequest {
  readonly ownerUid: string;
  readonly pageSize: number;
}

interface AuthorizedPublicPhotosRequest {
  readonly mode: PublicPhotoRankingMode;
  readonly pageSize: number;
  readonly nowMs: number;
}

interface AuthorizedPhotoDocument {
  readonly id?: unknown;
  readonly path?: unknown;
  readonly data?: unknown;
}

interface AuthorizedPhotosResponse {
  readonly documents?: AuthorizedPhotoDocument[];
}

const MAX_PHOTOS = 32;

@Injectable({ providedIn: 'root' })
export class PublicPhotoAudienceQueryService {
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly listProfilePhotosCallable = httpsCallable<
    AuthorizedProfilePhotosRequest,
    AuthorizedPhotosResponse
  >(this.functions, 'listAuthorizedProfilePhotos');
  private readonly listPublicPhotosCallable = httpsCallable<
    AuthorizedPublicPhotosRequest,
    AuthorizedPhotosResponse
  >(this.functions, 'listAuthorizedPublicPhotos');

  loadProfilePhotos$(
    ownerUid: string,
    pageSize = MAX_PHOTOS
  ): Observable<IPublicPhotoProjection[]> {
    const safeOwnerUid = this.cleanId(ownerUid);

    if (!safeOwnerUid) {
      return of([]);
    }

    const safePageSize = this.normalizePageSize(pageSize);

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.listProfilePhotosCallable({
        ownerUid: safeOwnerUid,
        pageSize: safePageSize,
      });

      return this.mapDocuments(
        response.data?.documents,
        safeOwnerUid
      );
    });
  }

  loadPublicPhotos$(
    mode: PublicPhotoRankingMode,
    pageSize = 24,
    nowMs = Date.now()
  ): Observable<IPublicPhotoProjection[]> {
    const safePageSize = this.normalizePageSize(pageSize);
    const safeNowMs = Number.isFinite(nowMs) && nowMs > 0
      ? Math.trunc(nowMs)
      : Date.now();

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.listPublicPhotosCallable({
        mode,
        pageSize: safePageSize,
        nowMs: safeNowMs,
      });

      return this.mapDocuments(response.data?.documents);
    });
  }

  private mapDocuments(
    rawDocuments: AuthorizedPhotoDocument[] | undefined,
    expectedOwnerUid?: string
  ): IPublicPhotoProjection[] {
    const documents = Array.isArray(rawDocuments) ? rawDocuments : [];

    return documents.flatMap((document) => {
      const id = this.cleanId(document?.id);
      const path = String(document?.path ?? '').trim();
      const data = document?.data;

      if (
        !id ||
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {
        return [];
      }

      const record = data as Record<string, unknown>;
      const ownerUid = this.cleanId(record['ownerUid']);
      const expectedPath =
        `public_profiles/${ownerUid}/public_photos/${id}`;

      if (
        !ownerUid ||
        path !== expectedPath ||
        (expectedOwnerUid && ownerUid !== expectedOwnerUid) ||
        String(record['visibility'] ?? '').trim().toUpperCase() !== 'PUBLIC' ||
        String(record['moderationStatus'] ?? '').trim().toUpperCase() !==
          'APPROVED' ||
        String(record['assetAccess'] ?? '').trim().toUpperCase() !==
          'SIGNED_URL'
      ) {
        return [];
      }

      return [{
        ...record,
        id,
        ownerUid,
      } as unknown as IPublicPhotoProjection];
    });
  }

  private cleanId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return normalized &&
      normalized.length <= 128 &&
      !normalized.includes('/')
      ? normalized
      : '';
  }

  private normalizePageSize(value: number): number {
    return Number.isFinite(value)
      ? Math.max(1, Math.min(MAX_PHOTOS, Math.trunc(value)))
      : MAX_PHOTOS;
  }
}
