import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { MediaApplicationErrorService } from './media-application-error.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { mapPublicVideoProjection } from './public-video-item.mapper';

export interface IPublicProfileVideoCursor {
  readonly orderIndex: number;
  readonly publishedAt: number;
  readonly documentId: string;
}

export interface IPublicProfileVideoPage {
  readonly items: readonly IPublicVideoItem[];
  readonly nextCursor: IPublicProfileVideoCursor | null;
  readonly hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;

@Injectable({ providedIn: 'root' })
export class PublicProfileVideoPaginationService {
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly publicVideoAccess = inject(PublicVideoAccessService);
  private readonly globalErrorHandler = inject(MediaApplicationErrorService);

  loadPage$(
    ownerUid: string,
    options: {
      readonly pageSize?: number;
      readonly cursor?: IPublicProfileVideoCursor | null;
    } = {}
  ): Observable<IPublicProfileVideoPage> {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const pageSize = this.normalizePageSize(options.pageSize);
    const cursor = this.normalizeCursor(options.cursor);

    if (!safeOwnerUid) {
      return of({ items: [], nextCursor: null, hasMore: false });
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        { ownerUid: string; pageSize: number; cursor: IPublicProfileVideoCursor | null },
        { items: readonly Record<string, unknown>[];
          nextCursor: IPublicProfileVideoCursor | null; hasMore: boolean }
      >(this.functions, 'getAuthorizedVideoOwnerPage');
      return (await callable({ ownerUid: safeOwnerUid, pageSize, cursor })).data;
    }).pipe(
      map((response) => {
        const projections = (response.items ?? []).flatMap((item) => {
          const projection = mapPublicVideoProjection({
            documentId: item['id'],
            expectedOwnerUid: safeOwnerUid,
            data: item,
          });
          return projection ? [projection] : [];
        }) as IPublicVideoProjection[];

        return {
          projections,
          nextCursor: response.hasMore === true
            ? this.normalizeCursor(response.nextCursor) : null,
        };
      }),
      switchMap(({ projections, nextCursor }) =>
        this.publicVideoAccess.hydratePublicVideoPreviews$(projections).pipe(
          map((items): IPublicProfileVideoPage => ({
            items,
            nextCursor,
            hasMore: nextCursor !== null,
          }))
        )
      ),
      catchError((error: unknown) => {
        this.reportError(error, safeOwnerUid, pageSize, !!cursor);
        return throwError(() => error);
      })
    );
  }

  private fromBackendCursor(
    cursor:
      | {
          readonly documentPath: string;
          readonly publishedAt?: number;
          readonly orderIndex?: number;
        }
      | null
      | undefined,
    hasMore: boolean
  ): IPublicProfileVideoCursor | null {
    if (!hasMore || !cursor) {
      return null;
    }

    const documentPath = String(cursor.documentPath ?? '').trim();
    const documentId = documentPath.split('/').pop() ?? '';

    if (!documentId) {
      return null;
    }

    return {
      orderIndex: this.safeNumber(cursor.orderIndex),
      publishedAt: this.safeNumber(cursor.publishedAt),
      documentId,
    };
  }

  private normalizeCursor(
    cursor: IPublicProfileVideoCursor | null | undefined
  ): IPublicProfileVideoCursor | null {
    if (!cursor) {
      return null;
    }

    const documentId = String(cursor.documentId ?? '').trim();
    if (!documentId) {
      return null;
    }

    return {
      orderIndex: this.safeNumber(cursor.orderIndex),
      publishedAt: this.safeNumber(cursor.publishedAt),
      documentId,
    };
  }

  private normalizePageSize(value: unknown): number {
    const parsed = Math.floor(Number(value ?? DEFAULT_PAGE_SIZE));
    if (!Number.isFinite(parsed)) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.max(1, Math.min(MAX_PAGE_SIZE, parsed));
  }

  private safeNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private reportError(
    error: unknown,
    ownerUid: string,
    pageSize: number,
    hasCursor: boolean
  ): void {
    this.globalErrorHandler.reportSilently(
      error,
      'loadPage$',
      'Falha ao paginar vídeos públicos do perfil.',
      {
        scope: 'PublicProfileVideoPaginationService',
        hasOwnerUid: !!ownerUid,
        pageSize,
        hasCursor,
      }
    );
  }

}
