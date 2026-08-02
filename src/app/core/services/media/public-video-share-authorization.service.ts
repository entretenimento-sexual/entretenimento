import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface AuthorizePublicVideoShareRequest {
  ownerUid: string;
  videoId: string;
}

interface AuthorizePublicVideoShareResponse {
  ownerUid: string;
  videoId: string;
  canonicalPath: string;
}

interface ContextualError extends Error {
  original?: unknown;
  context?: Record<string, unknown>;
  skipUserNotification?: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

@Injectable({ providedIn: 'root' })
export class PublicVideoShareAuthorizationService {
  private readonly functions = inject(Functions);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  authorizeShare$(
    ownerUidValue: unknown,
    videoIdValue: unknown
  ): Observable<string | null> {
    const ownerUid = normalizeId(ownerUidValue);
    const videoId = normalizeId(videoIdValue);

    if (!ownerUid || !videoId) {
      return of(null);
    }

    const expectedPath = `/media/video/${ownerUid}/${videoId}`;

    return defer(async () => {
      const callable = httpsCallable<
        AuthorizePublicVideoShareRequest,
        AuthorizePublicVideoShareResponse
      >(this.functions, 'authorizePublicVideoShare');
      const response = await callable({ ownerUid, videoId });
      return response.data;
    }).pipe(
      map((response) =>
        response?.ownerUid === ownerUid &&
        response?.videoId === videoId &&
        response?.canonicalPath === expectedPath
          ? expectedPath
          : null
      ),
      catchError((error: unknown) => {
        this.reportError(error, { ownerUid, videoId });
        return throwError(() => error);
      })
    );
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError: ContextualError = error instanceof Error
        ? error
        : new Error('Erro ao autorizar compartilhamento de vídeo.');

      normalizedError.original = error;
      normalizedError.context = {
        scope: 'PublicVideoShareAuthorizationService',
        op: 'authorizeShare$',
        ...context,
      };
      normalizedError.skipUserNotification = true;
      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
