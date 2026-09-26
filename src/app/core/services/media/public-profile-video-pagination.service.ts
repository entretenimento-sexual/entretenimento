import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { MediaApplicationErrorService } from './media-application-error.service';
import {
  PublicMediaReadBoundaryService,
} from './public-media-read-boundary.service';
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
  private readonly publicMediaRead = inject(PublicMediaReadBoundaryService);
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

    return this.publicMediaRead.read$({
      mediaType: 'VIDEO',
      mode: 'PROFILE',
      ownerUids: [safeOwnerUid],
      limit: pageSize,
      cursor: cursor
        ? {
            documentPath:
              `public_profiles/${safeOwnerUid}/public_videos/${cursor.documentId}`,
            orderIndex: cursor.orderIndex,
            publishedAt: cursor.publishedAt,
          }
        : null,
    }).pipe(
      map((response) => {
        const projections = (response.items ?? []).flatMap((item) => {
          const source = item as Record<string, unknown>;
          const projection = mapPublicVideoProjection({
            documentId: source['id'],
            expectedOwnerUid: safeOwnerUid,
            data: source,
          });

          return projection ? [projection] : [];
        }) as IPublicVideoProjection[];

        return {
          projections,
          nextCursor: this.fromBackendCursor(
            response.nextCursor,
            response.hasMore
          ),
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
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao paginar vídeos públicos do perfil.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicProfileVideoPaginationService',
        op: 'loadPage$',
        hasOwnerUid: !!ownerUid,
        pageSize,
        hasCursor,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // O diagnóstico não deve interromper a propagação do erro ao componente.
    }
  }
}
