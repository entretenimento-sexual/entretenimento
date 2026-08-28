import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from '@angular/fire/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
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

interface PublicProfileVideoRawDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

interface PublicProfileVideoRawPage {
  readonly documents: readonly PublicProfileVideoRawDocument[];
  readonly nextCursor: IPublicProfileVideoCursor | null;
  readonly hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;

@Injectable({ providedIn: 'root' })
export class PublicProfileVideoPaginationService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly publicVideoAccess = inject(PublicVideoAccessService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

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
      return new Observable<IPublicProfileVideoPage>((subscriber) => {
        subscriber.next({ items: [], nextCursor: null, hasMore: false });
        subscriber.complete();
      });
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const publicVideos = collection(
        this.firestore,
        `public_profiles/${safeOwnerUid}/public_videos`
      );
      const constraints = this.buildConstraints(pageSize, cursor);
      const snapshot = await getDocs(query(publicVideos, ...constraints));
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocuments = snapshot.docs.slice(0, pageSize).map((document) => ({
        id: document.id,
        data: document.data() as Record<string, unknown>,
      }));
      const lastDocument = pageDocuments.at(-1) ?? null;

      return {
        documents: pageDocuments,
        nextCursor: hasMore && lastDocument
          ? this.buildCursor(lastDocument)
          : null,
        hasMore,
      } satisfies PublicProfileVideoRawPage;
    }).pipe(
      map((rawPage) => ({
        rawPage,
        projections: rawPage.documents.flatMap((document) => {
          const projection = mapPublicVideoProjection({
            documentId: document.id,
            expectedOwnerUid: safeOwnerUid,
            data: document.data,
          });

          return projection ? [projection] : [];
        }) as IPublicVideoProjection[],
      })),
      switchMap(({ rawPage, projections }) =>
        this.publicVideoAccess.hydratePublicVideoPreviews$(projections).pipe(
          map((items): IPublicProfileVideoPage => ({
            items,
            nextCursor: rawPage.nextCursor,
            hasMore: rawPage.hasMore,
          }))
        )
      ),
      catchError((error: unknown) => {
        this.reportError(error, safeOwnerUid, pageSize, !!cursor);
        return throwError(() => error);
      })
    );
  }

  private buildConstraints(
    pageSize: number,
    cursor: IPublicProfileVideoCursor | null
  ): QueryConstraint[] {
    const constraints: QueryConstraint[] = [
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED'),
      orderBy('orderIndex', 'asc'),
      orderBy('publishedAt', 'desc'),
      orderBy(documentId(), 'desc'),
    ];

    if (cursor) {
      constraints.push(startAfter(
        cursor.orderIndex,
        cursor.publishedAt,
        cursor.documentId
      ));
    }

    constraints.push(limit(pageSize + 1));
    return constraints;
  }

  private buildCursor(
    document: PublicProfileVideoRawDocument
  ): IPublicProfileVideoCursor {
    return {
      orderIndex: this.safeNumber(document.data['orderIndex']),
      publishedAt: this.safeNumber(document.data['publishedAt']),
      documentId: document.id,
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
