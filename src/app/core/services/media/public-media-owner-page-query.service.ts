import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  collectionGroup,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicMediaOwnerCursor,
  IPublicMediaOwnerPage,
  IPublicMediaOwnerPageRequest,
  IPublicPhotoOwnerPage,
  IPublicVideoOwnerPage,
  TPublicMediaOwnerPageKind,
} from 'src/app/core/interfaces/media/i-public-media-owner-page';
import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { mapPublicVideoProjection } from './public-video-item.mapper';

interface PublicMediaOwnerRawDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

interface PublicMediaOwnerRawPage {
  readonly documents: readonly PublicMediaOwnerRawDocument[];
  readonly nextCursor: IPublicMediaOwnerCursor | null;
  readonly hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;
const MAX_OWNER_UIDS = 30;
const SAFE_PUBLIC_MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Paginação estável de mídia pública para um conjunto conhecido de autores.
 *
 * O cursor combina `publishedAt` e `documentId()` para impedir saltos ou
 * repetições quando duas publicações possuem o mesmo timestamp. A consulta usa
 * somente projeções PUBLIC + APPROVED e mantém URLs assinadas fora do cursor.
 */
@Injectable({ providedIn: 'root' })
export class PublicMediaOwnerPageQueryService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly photoAccess = inject(PublicPhotoAccessService);
  private readonly videoAccess = inject(PublicVideoAccessService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  loadPhotoPage$(
    request: IPublicMediaOwnerPageRequest
  ): Observable<IPublicPhotoOwnerPage> {
    return this.loadRawPage$('PHOTO', request).pipe(
      switchMap((rawPage) => {
        const projections = rawPage.documents.map((document) => ({
          ...document.data,
          id: document.id,
        }) as unknown as IPublicPhotoProjection);

        return this.photoAccess.hydratePublicPhotoUrls$(projections).pipe(
          map((items): IPublicPhotoOwnerPage => ({
            items,
            nextCursor: rawPage.nextCursor,
            hasMore: rawPage.hasMore,
            failed: false,
            loadedAt: Date.now(),
          }))
        );
      }),
      catchError((error: unknown) =>
        this.handlePageError$<IPublicPhotoItem>('PHOTO', request, error)
      )
    );
  }

  loadVideoPage$(
    request: IPublicMediaOwnerPageRequest
  ): Observable<IPublicVideoOwnerPage> {
    return this.loadRawPage$('VIDEO', request).pipe(
      map((rawPage) => ({
        rawPage,
        projections: rawPage.documents.flatMap((document) => {
          const projection = mapPublicVideoProjection({
            documentId: document.id,
            data: document.data,
          });
          return projection ? [projection] : [];
        }),
      })),
      switchMap(({ rawPage, projections }) =>
        this.videoAccess.hydratePublicVideoPreviews$(projections).pipe(
          map((items): IPublicVideoOwnerPage => ({
            items,
            nextCursor: rawPage.nextCursor,
            hasMore: rawPage.hasMore,
            failed: false,
            loadedAt: Date.now(),
          }))
        )
      ),
      catchError((error: unknown) =>
        this.handlePageError$<IPublicVideoItem>('VIDEO', request, error)
      )
    );
  }

  private loadRawPage$(
    kind: TPublicMediaOwnerPageKind,
    request: IPublicMediaOwnerPageRequest
  ): Observable<PublicMediaOwnerRawPage> {
    const ownerUids = this.normalizeOwnerUids(request.ownerUids);
    const pageSize = this.normalizePageSize(request.pageSize);
    const cursor = this.normalizeCursor(kind, request.cursor);

    if (!ownerUids.length) {
      return of({ documents: [], nextCursor: null, hasMore: false });
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const collectionName = kind === 'PHOTO' ? 'public_photos' : 'public_videos';
      const mediaGroup = collectionGroup(this.firestore, collectionName);
      const constraints: QueryConstraint[] = [
        where('ownerUid', 'in', ownerUids),
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED'),
        orderBy('publishedAt', 'desc'),
        orderBy(documentId(), 'desc'),
      ];

      if (cursor) {
        constraints.push(startAfter(cursor.publishedAt, cursor.documentPath));
      }

      constraints.push(limit(pageSize + 1));

      const snapshot = await getDocs(query(mediaGroup, ...constraints));
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocuments = snapshot.docs.slice(0, pageSize);
      const documents = pageDocuments.map((document) => ({
        id: document.id,
        path: document.ref.path,
        data: document.data() as Record<string, unknown>,
      }));
      const lastDocument = documents.at(-1) ?? null;

      return {
        documents,
        nextCursor: hasMore && lastDocument
          ? this.buildCursor(kind, lastDocument)
          : null,
        hasMore,
      };
    });
  }

  private handlePageError$<TItem>(
    kind: TPublicMediaOwnerPageKind,
    request: IPublicMediaOwnerPageRequest,
    error: unknown
  ): Observable<IPublicMediaOwnerPage<TItem>> {
    const ownerCount = this.normalizeOwnerUids(request.ownerUids).length;
    const pageSize = this.normalizePageSize(request.pageSize);

    if (request.notifyOnError === true) {
      this.errorNotification.showWarning(
        'Não foi possível carregar mais publicações agora.'
      );
    }

    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao paginar mídia pública por autores.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicMediaOwnerPageQueryService',
        op: kind === 'PHOTO' ? 'loadPhotoPage$' : 'loadVideoPage$',
        kind,
        ownerCount,
        pageSize,
        hasCursor: !!request.cursor,
      };
      (normalized as any).skipUserNotification = true;
      this.globalError.handleError(normalized);
    } catch {
      // O diagnóstico não deve impedir retry da paginação.
    }

    return of({
      items: [],
      nextCursor: this.normalizeCursor(kind, request.cursor),
      hasMore: ownerCount > 0,
      failed: true,
      loadedAt: Date.now(),
    });
  }

  private buildCursor(
    kind: TPublicMediaOwnerPageKind,
    document: PublicMediaOwnerRawDocument
  ): IPublicMediaOwnerCursor {
    return {
      kind,
      publishedAt: this.safeNumber(document.data['publishedAt']),
      documentPath: document.path,
    };
  }

  private normalizeCursor(
    kind: TPublicMediaOwnerPageKind,
    value: IPublicMediaOwnerCursor | null | undefined
  ): IPublicMediaOwnerCursor | null {
    if (!value || value.kind !== kind) {
      return null;
    }

    const expectedSegment = kind === 'PHOTO' ? '/public_photos/' : '/public_videos/';
    const documentPath = String(value.documentPath ?? '').trim();
    const publishedAt = this.safeNumber(value.publishedAt);

    if (!documentPath.includes(expectedSegment)) {
      return null;
    }

    return { kind, publishedAt, documentPath };
  }

  private normalizeOwnerUids(values: readonly string[]): string[] {
    const unique = new Set<string>();

    for (const value of values ?? []) {
      const uid = String(value ?? '').trim();
      if (!SAFE_PUBLIC_MEDIA_ID_PATTERN.test(uid)) continue;
      unique.add(uid);
      if (unique.size >= MAX_OWNER_UIDS) break;
    }

    return [...unique];
  }

  private normalizePageSize(value: unknown): number {
    const parsed = Number(value ?? DEFAULT_PAGE_SIZE);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
  }

  private safeNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
}
