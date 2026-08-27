import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicPhotoRankingCursor,
  IPublicPhotoRankingPage,
  IPublicPhotoRankingRequest,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import { IPublicPhotoProjection } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import {
  IPublicPhotoRankingRawDocument,
  PublicPhotoRankingFirestoreGateway,
} from './public-photo-ranking-firestore.gateway';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 16;

@Injectable({ providedIn: 'root' })
export class PublicPhotoRankingQueryService {
  constructor(
    private readonly gateway: PublicPhotoRankingFirestoreGateway,
    private readonly publicPhotoAccess: PublicPhotoAccessService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  loadPage$(
    request: IPublicPhotoRankingRequest
  ): Observable<IPublicPhotoRankingPage> {
    const mode = this.normalizeMode(request.mode);
    const pageSize = this.normalizePageSize(request.pageSize);
    const cursor = this.normalizeCursor(mode, request.cursor);

    return this.gateway.loadPage$({ mode, pageSize, cursor }).pipe(
      map((rawPage) => ({
        rawPage,
        projections: rawPage.documents.map((document) =>
          this.mapDocument(document)
        ),
      })),
      switchMap(({ rawPage, projections }) =>
        this.publicPhotoAccess.hydratePublicPhotoUrls$(projections).pipe(
          map((items): IPublicPhotoRankingPage => ({
            mode,
            source: mode,
            items,
            nextCursor: rawPage.nextCursor,
            hasMore: rawPage.hasMore,
            loadedAt: Date.now(),
          }))
        )
      ),
      catchError((error: unknown) => {
        this.reportError(error, mode, pageSize, request.notifyOnError === true);

        return request.propagateErrors === true
          ? throwError(() => error)
          : of(this.emptyPage(mode));
      })
    );
  }

  private mapDocument(
    document: IPublicPhotoRankingRawDocument
  ): IPublicPhotoProjection {
    return {
      ...(document.data as unknown as IPublicPhotoProjection),
      id: document.id,
    };
  }

  private normalizeMode(value: unknown): TPublicPhotoRankingMode {
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
    mode: TPublicPhotoRankingMode,
    value: IPublicPhotoRankingCursor | null | undefined
  ): IPublicPhotoRankingCursor | null {
    if (!value || value.mode !== mode) {
      return null;
    }

    const documentPath = String(value.documentPath ?? '').trim();

    if (!documentPath.includes('/public_photos/')) {
      return null;
    }

    return {
      mode,
      score: this.safeNumber(value.score),
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
    mode: TPublicPhotoRankingMode
  ): IPublicPhotoRankingPage {
    return {
      mode,
      source: mode,
      items: [],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    };
  }

  private reportError(
    error: unknown,
    mode: TPublicPhotoRankingMode,
    pageSize: number,
    notifyUser: boolean
  ): void {
    if (notifyUser) {
      this.errorNotifier.showError(
        'Não foi possível carregar as fotos públicas.'
      );
    }

    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Erro ao consultar ranking público de fotos.');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: Record<string, unknown>;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PublicPhotoRankingQueryService',
        op: 'loadPage$',
        mode,
        pageSize,
      };
      contextual.skipUserNotification = true;
      this.errorHandler.handleError(contextual);
    } catch {
      // A falha de diagnóstico não deve substituir o erro de consulta.
    }
  }
}
