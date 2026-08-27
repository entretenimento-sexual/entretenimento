import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  TPublicMediaIdentityType,
  buildPublicMediaIdentity,
} from 'src/app/core/utils/media/public-media-identity';

export interface IPublicMediaRecentViewCandidate {
  readonly mediaType: TPublicMediaIdentityType;
  readonly ownerUid: string;
  readonly mediaId: string;
}

interface IRecentPublicMediaViewRequest {
  items: IPublicMediaRecentViewCandidate[];
}

interface IRecentPublicMediaViewResponse {
  items: IPublicMediaRecentViewCandidate[];
}

export interface PublicMediaRecentViewOptions {
  readonly propagateErrors?: boolean;
}

const MAX_RECENT_VIEW_CANDIDATES = 48;

@Injectable({ providedIn: 'root' })
export class PublicMediaRecentViewService {
  private readonly functions = inject(Functions);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  resolveRecentViewedKeys$(
    candidates: readonly IPublicMediaRecentViewCandidate[],
    options: PublicMediaRecentViewOptions = {}
  ): Observable<readonly string[]> {
    const normalized = this.normalizeCandidates(candidates);

    if (!normalized.length) {
      return of([]);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        IRecentPublicMediaViewRequest,
        IRecentPublicMediaViewResponse
      >(this.functions, 'getRecentPublicMediaViews');
      const response = await callable({ items: normalized });

      return response.data?.items ?? [];
    }).pipe(
      map((items) => {
        const keys = new Set<string>();

        for (const item of items ?? []) {
          const key = buildPublicMediaIdentity(
            item.mediaType,
            item.ownerUid,
            item.mediaId
          );
          if (key) keys.add(key);
        }

        return [...keys];
      }),
      catchError((error: unknown) => {
        this.reportError(error, normalized.length);

        return options.propagateErrors
          ? throwError(() => error)
          : of([] as readonly string[]);
      })
    );
  }

  private normalizeCandidates(
    candidates: readonly IPublicMediaRecentViewCandidate[]
  ): IPublicMediaRecentViewCandidate[] {
    const unique = new Map<string, IPublicMediaRecentViewCandidate>();

    for (const candidate of candidates ?? []) {
      const mediaType = candidate?.mediaType;
      const ownerUid = String(candidate?.ownerUid ?? '').trim();
      const mediaId = String(candidate?.mediaId ?? '').trim();
      const key = buildPublicMediaIdentity(mediaType, ownerUid, mediaId);

      if (!key) continue;

      unique.set(key, { mediaType, ownerUid, mediaId });
      if (unique.size >= MAX_RECENT_VIEW_CANDIDATES) break;
    }

    return [...unique.values()];
  }

  private reportError(error: unknown, candidateCount: number): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao resolver mídias vistas recentemente.');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: Record<string, unknown>;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PublicMediaRecentViewService',
        op: 'resolveRecentViewedKeys$',
        candidateCount,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // A falha de diagnóstico não deve afetar o feed.
    }
  }
}
