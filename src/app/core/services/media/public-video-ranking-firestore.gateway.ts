import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  IPublicVideoRankingCursor,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import {
  PublicMediaReadBoundaryService,
} from './public-media-read-boundary.service';

export interface IPublicVideoRankingRawDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

export interface IPublicVideoRankingRawPage {
  readonly documents: readonly IPublicVideoRankingRawDocument[];
  readonly nextCursor: IPublicVideoRankingCursor | null;
  readonly hasMore: boolean;
}

export interface IPublicVideoRankingGatewayRequest {
  readonly mode: TPublicVideoRankingMode;
  readonly pageSize: number;
  readonly cursor: IPublicVideoRankingCursor | null;
}

@Injectable({ providedIn: 'root' })
export class PublicVideoRankingFirestoreGateway {
  private readonly publicMediaRead = inject(PublicMediaReadBoundaryService);

  loadPage$(
    request: IPublicVideoRankingGatewayRequest
  ): Observable<IPublicVideoRankingRawPage> {
    return this.publicMediaRead.read$({
      mediaType: 'VIDEO',
      mode: request.mode === 'top' ? 'TOP' : 'LATEST',
      limit: request.pageSize,
      cursor: request.cursor
        ? {
            documentPath: request.cursor.documentPath,
            score: request.cursor.score,
            uniqueViewersCount: request.cursor.uniqueViewersCount,
            viewsCount: request.cursor.viewsCount,
            publishedAt: request.cursor.publishedAt,
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
              uniqueViewersCount: this.safeNumber(
                response.nextCursor.uniqueViewersCount
              ),
              viewsCount: this.safeNumber(
                response.nextCursor.viewsCount
              ),
              publishedAt: this.safeNumber(
                response.nextCursor.publishedAt
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
