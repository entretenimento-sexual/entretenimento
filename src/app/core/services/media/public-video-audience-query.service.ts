import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';

import { IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { mapPublicVideoProjection } from './public-video-item.mapper';

interface AuthorizedProfileVideosRequest {
  readonly ownerUid: string;
  readonly pageSize: number;
}

interface AuthorizedProfileVideoDocument {
  readonly id?: unknown;
  readonly path?: unknown;
  readonly data?: unknown;
}

interface AuthorizedProfileVideosResponse {
  readonly documents?: AuthorizedProfileVideoDocument[];
}

const MAX_PROFILE_VIDEOS = 32;

@Injectable({ providedIn: 'root' })
export class PublicVideoAudienceQueryService {
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly listProfileVideosCallable = httpsCallable<
    AuthorizedProfileVideosRequest,
    AuthorizedProfileVideosResponse
  >(this.functions, 'listAuthorizedProfileVideos');

  loadProfileVideos$(
    ownerUid: string,
    pageSize = MAX_PROFILE_VIDEOS
  ): Observable<IPublicVideoProjection[]> {
    const safeOwnerUid = String(ownerUid ?? '').trim();

    if (!safeOwnerUid || safeOwnerUid.includes('/')) {
      return of([]);
    }

    const safePageSize = Number.isFinite(pageSize)
      ? Math.max(1, Math.min(MAX_PROFILE_VIDEOS, Math.trunc(pageSize)))
      : MAX_PROFILE_VIDEOS;

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.listProfileVideosCallable({
        ownerUid: safeOwnerUid,
        pageSize: safePageSize,
      });
      const documents = Array.isArray(response.data?.documents)
        ? response.data.documents
        : [];

      return documents.flatMap((document) => {
        const id = String(document?.id ?? '').trim();
        const path = String(document?.path ?? '').trim();
        const data = document?.data;
        const expectedPath =
          `public_profiles/${safeOwnerUid}/public_videos/${id}`;

        if (
          !id ||
          path !== expectedPath ||
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        ) {
          return [];
        }

        const projection = mapPublicVideoProjection({
          documentId: id,
          expectedOwnerUid: safeOwnerUid,
          data: data as Record<string, unknown>,
        });

        return projection &&
          projection.visibility === 'PUBLIC' &&
          projection.moderationStatus === 'APPROVED' &&
          projection.assetAccess === 'SIGNED_URL'
          ? [projection]
          : [];
      });
    });
  }
}
