import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  IPublicPhotoRankingCursor,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import {
  PublicMediaReadBoundaryService,
} from './public-media-read-boundary.service';

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
  private readonly publicMediaRead = inject(PublicMediaReadBoundaryService);

  loadPage$(
    request: IPublicPhotoRankingGatewayRequest
  ): Observable<IPublicPhotoRankingRawPage> {
    return this.publicMediaRead.read$({
      mediaType: 'PHOTO',
      mode:
        request.mode === 'top'
          ? 'TOP'
          : request.mode === 'boosted'
            ? 'BOOSTED'
            : 'LATEST',
      limit: request.pageSize,
      cursor: request.cursor
        ? {
            documentPath: request.cursor.documentPath,
            score: request.cursor.score,
            publishedAt: request.cursor.publishedAt,
            boostedUntil: request.cursor.boostedUntil,
          }
        : null,
    }).pipe(
      map((response) => {
        const documents = (response.items ?? []).flatMap((item) => {
          const source = item as Record<string, unknown>;
          const id = String(source['id'] ?? '').trim();
          const path = String(source['documentPath'] ?? '').trim();

          return id && path
            ? [{ id, path, data: source }]
            : [];
        });

        const nextCursor = response.nextCursor
          ? {
              mode: request.mode,
              score: this.safeNumber(response.nextCursor.score),
              publishedAt: this.safeNumber(
                response.nextCursor.publishedAt
              ),
              boostedUntil: this.safeNumber(
                response.nextCursor.boostedUntil
              ),
              documentPath: String(
                response.nextCursor.documentPath ?? ''
              ).trim(),
            }
          : null;

        return {
          documents,
          nextCursor:
            nextCursor?.documentPath ? nextCursor : null,
          hasMore: response.hasMore === true,
        };
      })
    );
  }

  private safeNumber(value: unknown): number {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) && numberValue > 0
      ? numberValue
      : 0;
  }
}
