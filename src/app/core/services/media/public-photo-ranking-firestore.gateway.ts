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
import { Observable } from 'rxjs';

import {
  IPublicPhotoRankingCursor,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

export interface IPublicPhotoRankingRawDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

export interface IPublicPhotoRankingRawPage {
  readonly documents: readonly IPublicPhotoRankingRawDocument[];
  readonly nextCursor: IPublicPhotoRankingCursor | null;
  readonly hasMore: boolean;
}

export interface IPublicPhotoRankingGatewayRequest {
  readonly mode: TPublicPhotoRankingMode;
  readonly pageSize: number;
  readonly cursor: IPublicPhotoRankingCursor | null;
}

@Injectable({ providedIn: 'root' })
export class PublicPhotoRankingFirestoreGateway {
  private readonly firestore = inject(Firestore);
  private readonly firestoreCtx = inject(FirestoreContextService);

  loadPage$(
    request: IPublicPhotoRankingGatewayRequest
  ): Observable<IPublicPhotoRankingRawPage> {
    return this.firestoreCtx.deferPromise$(async () => {
      const publicPhotos = collectionGroup(this.firestore, 'public_photos');
      const constraints = this.buildConstraints(request);
      const snapshot = await getDocs(query(publicPhotos, ...constraints));
      const hasMore = snapshot.docs.length > request.pageSize;
      const pageDocuments = snapshot.docs.slice(0, request.pageSize);
      const documents = pageDocuments.map((document) => ({
        id: document.id,
        path: document.ref.path,
        data: document.data() as Record<string, unknown>,
      }));
      const lastDocument = documents.at(-1) ?? null;

      return {
        documents,
        nextCursor: hasMore && lastDocument
          ? this.buildCursor(request.mode, lastDocument)
          : null,
        hasMore,
      };
    });
  }

  private buildConstraints(
    request: IPublicPhotoRankingGatewayRequest
  ): QueryConstraint[] {
    const constraints: QueryConstraint[] = [
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED'),
    ];

    if (request.mode === 'top') {
      constraints.push(
        orderBy('score', 'desc'),
        orderBy('publishedAt', 'desc'),
        orderBy(documentId(), 'desc')
      );

      if (request.cursor?.mode === 'top') {
        constraints.push(startAfter(
          request.cursor.score,
          request.cursor.publishedAt,
          request.cursor.documentPath
        ));
      }
    } else {
      constraints.push(
        orderBy('publishedAt', 'desc'),
        orderBy(documentId(), 'desc')
      );

      if (request.cursor?.mode === 'latest') {
        constraints.push(startAfter(
          request.cursor.publishedAt,
          request.cursor.documentPath
        ));
      }
    }

    constraints.push(limit(request.pageSize + 1));
    return constraints;
  }

  private buildCursor(
    mode: TPublicPhotoRankingMode,
    document: IPublicPhotoRankingRawDocument
  ): IPublicPhotoRankingCursor {
    return {
      mode,
      score: this.safeNumber(document.data['score']),
      publishedAt: this.safeNumber(document.data['publishedAt']),
      documentPath: document.path,
    };
  }

  private safeNumber(value: unknown): number {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) && numberValue > 0
      ? numberValue
      : 0;
  }
}
