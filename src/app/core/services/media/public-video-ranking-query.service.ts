import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicVideoRankingCursor,
  IPublicVideoRankingPage,
  IPublicVideoRankingRequest,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import { IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicVideoAccessService } from './public-video-access.service';
import {
  IPublicVideoRankingRawDocument,
  PublicVideoRankingFirestoreGateway,
} from './public-video-ranking-firestore.gateway';
import { mapPublicVideoProjection } from './public-video-item.mapper';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 16;

@Injectable({ providedIn: 'root' })
export class PublicVideoRankingQueryService {
  constructor(
    private readonly gateway: PublicVideoRankingFirestoreGateway,
    private readonly publicVideoAccess: PublicVideoAccessService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  loadPage$(
    request: IPublicVideoRankingRequest
  ): Observable<IPublicVideoRankingPage> {
    const mode = this.normalizeMode(request.mode);
    const pageSize = this.normalizePageSize(request.pageSize);
    const cursor = this.normalizeCursor(mode, request.cursor);

    return this.gateway.loadPage$({ mode, pageSize, cursor }).pipe(
      map((rawPage) => ({
        rawPage,
        projections: rawPage.documents.flatMap((document) => {
          const projection = this.mapDocument(document);
          return projection ? [projection] : [];
        }),
      })),
      switchMap(({ rawPage, projections }) =>
        this.publicVideoAccess.hydratePublicVideoUrls$(projections).pipe(
          map((items): IPublicVideoRankingPage => ({
            mode,
            source: mode === 'top' ? 'top' : 'latest',
            items,
            nextCursor: rawPage.nextCursor,
            hasMore: rawPage.hasMore,
            loadedAt: Date.now(),
          }))
        )
      ),
      catchError((error: unknown) => {
        this.reportError(error, mode, pageSize, request.notifyOnError === true);
        return of(this.emptyPage(mode));
      })
    );
  }

  private mapDocument(
    document: IPublicVideoRankingRawDocument
  ): IPublicVideoProjection | null {
    return mapPublicVideoProjection({
      documentId: document.id,
      data: document.data,
    });
  }

  private normalizeMode(value: unknown): TPublicVideoRankingMode {
    return value === 'latest' ? 'latest' : 'top';
  }

  private normalizePageSize(value: unknown): number {
    const pageSize = Number(value ?? DEFAULT_PAGE_SIZE);

    if (!Number.isFinite(pageSize)) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(pageSize)));
  }

  private normalizeCursor(
    mode: TPublicVideoRankingMode,
    value: IPublicVideoRankingCursor | null | undefined
  ): IPublicVideoRankingCursor | null {
    if (!value || value.mode !== mode) {
      return null;
    }

    const documentPath = String(value.documentPath ?? '').trim();

    if (!documentPath.includes('/public_videos/')) {
      return null;
    }

    return {
      mode,
      score: this.safeNumber(value.score),
      uniqueViewersCount: this.safeNumber(value.uniqueViewersCount),
      viewsCount: this.safeNumber(value.viewsCount),
      publishedAt: this.safeNumber(value.publishedAt),
      documentPath,
    };
  }

  private safeNumber(value: unknown): number {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) && numberValue > 0
      ? numberValue
      : 0;
  }

  private emptyPage(
    mode: TPublicVideoRankingMode
  ): IPublicVideoRankingPage {
    return {
      mode,
      source: mode === 'top' ? 'top' : 'latest',
      items: [],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    };
  }

  private reportError(
    error: unknown,
    mode: TPublicVideoRankingMode,
    pageSize: number,
    notifyUser: boolean
  ): void {
    if (notifyUser) {
      this.errorNotifier.showError(
        'Não foi possível carregar os vídeos públicos.'
      );
    }

    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Erro ao consultar ranking público de vídeos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicVideoRankingQueryService',
        op: 'loadPage$',
        mode,
        pageSize,
      };
      (normalized as any).skipUserNotification = true;

      this.errorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
