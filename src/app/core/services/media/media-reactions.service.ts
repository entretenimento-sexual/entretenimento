// src/app/core/services/media/media-reactions.service.ts
// Reações públicas do domínio Media.
//
// Objetivo:
// - usar apenas a projeção pública da foto;
// - não gravar curtidas na coleção privada users/{uid}/photos;
// - permitir reação somente em foto pública, aprovada e com reações habilitadas;
// - manter contagem reativa por campo agregado na foto pública;
// - manter estado "curtido pelo usuário atual" por subdocumento;
// - usar transaction para evitar inconsistência básica de contagem;
// - centralizar erros;
// - manter debug sanitizado via PrivacyDebugLoggerService.
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  runTransaction,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take } from 'rxjs/operators';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPhotoPublicationScore } from '../../interfaces/media/i-photo-publication-config';

type PublicPhotoReactionDoc = {
  uid: string;
  createdAt: number;
};

@Injectable({ providedIn: 'root' })
export class MediaReactionsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    ) {}

  getPhotoLikesCount$(ownerUid: string, photoId: string): Observable<number> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);

    if (!safeOwnerUid || !safePhotoId) {
      return of(0);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const photoRef = doc(
        this.firestore,
        this.publicPhotoPath(safeOwnerUid, safePhotoId)
      );

      return docData(photoRef).pipe(
        map((value) => {
          const photo = value as Partial<IPublicPhotoItem> | undefined;
          const count = Number(photo?.reactionsCount ?? photo?.likesCount ?? 0);

          return Number.isFinite(count) && count > 0 ? count : 0;
        })
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao carregar curtidas da foto.',
          error,
          {
            op: 'getPhotoLikesCount$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
          },
          true
        );

        return of(0);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  isPhotoLikedByViewer$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<boolean> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);
    const safeViewerUid = this.cleanId(viewerUid);

    if (!safeOwnerUid || !safePhotoId || !safeViewerUid) {
      return of(false);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const likeRef = doc(
        this.firestore,
        this.publicPhotoLikePath(safeOwnerUid, safePhotoId, safeViewerUid)
      );

      return docData(likeRef).pipe(map((value) => !!value));
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao verificar curtida da foto.',
          error,
          {
            op: 'isPhotoLikedByViewer$',
            hasOwnerUid: !!safeOwnerUid,
            hasPhotoId: !!safePhotoId,
            hasViewerUid: !!safeViewerUid,
          },
          true
        );

        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  toggleLikePhoto$(
    ownerUid: string,
    photoId: string,
    viewerUid: string | null
  ): Observable<void> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safePhotoId = this.cleanId(photoId);
    const safeViewerUid = this.cleanId(viewerUid);

    if (!safeOwnerUid || !safePhotoId || !safeViewerUid) {
      return of(void 0);
    }

return this.firestoreCtx.deferPromise$(async () => {
  const callable = httpsCallable<
    { ownerUid: string; photoId: string },
    { liked: boolean; reactionsCount: number; score: number }
  >(this.functions, 'togglePhotoReaction');

  await callable({
    ownerUid: safeOwnerUid,
    photoId: safePhotoId,
  });
}).pipe(
  map(() => void 0),
  catchError((error) => {
    this.reportError(
      'Erro ao atualizar curtida da foto.',
      error,
      {
        op: 'toggleLikePhoto$',
        hasOwnerUid: !!safeOwnerUid,
        hasPhotoId: !!safePhotoId,
        hasViewerUid: !!safeViewerUid,
      },
      false
    );

    return of(void 0);
  })
);
  }

  private publicPhotoPath(ownerUid: string, photoId: string): string {
    return `public_profiles/${ownerUid}/public_photos/${photoId}`;
  }

  private publicPhotoLikePath(
    ownerUid: string,
    photoId: string,
    viewerUid: string
  ): string {
    return `${this.publicPhotoPath(ownerUid, photoId)}/likes/${viewerUid}`;
  }

  private cleanId(value: string | null | undefined): string {
    return String(value ?? '').trim();
  }

  private normalizeCount(value: unknown): number {
    const count = Number(value ?? 0);

    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }

    return Math.floor(count);
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('media', `MediaReactionsService: ${message}`, extra);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    silent = false
  ): void {
    if (!silent) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {
        // noop
      }
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'MediaReactionsService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = silent;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }

  private buildNextScore(
  photo: IPublicPhotoItem,
  nextReactionsCount: number
): {
  score: number;
  engagementScore: number;
  scoreBreakdown: IPhotoPublicationScore;
} {
  const currentBreakdown = photo.scoreBreakdown ?? {
    rankingScore: 0,
    qualityScore: 0,
    engagementScore: 0,
    safetyScore: 100,
  };

  const commentsCount = this.normalizeCount(photo.commentsCount ?? 0);

  const engagementScore = this.calculateEngagementScore({
    reactionsCount: nextReactionsCount,
    commentsCount,
  });

  const scoreBreakdown: IPhotoPublicationScore = {
    qualityScore: this.normalizeScore(currentBreakdown.qualityScore ?? 0),
    safetyScore: this.normalizeScore(currentBreakdown.safetyScore ?? 100),
    engagementScore,
    rankingScore: 0,
  };

  scoreBreakdown.rankingScore = this.calculateRankingScore(scoreBreakdown);

  return {
    score: scoreBreakdown.rankingScore,
    engagementScore,
    scoreBreakdown,
  };
}

private calculateEngagementScore(input: {
  reactionsCount: number;
  commentsCount: number;
}): number {
  const weightedEngagement =
    input.reactionsCount * 2 +
    input.commentsCount * 4;

  /*
    Escala logarítmica:
    - evita que uma foto com muitos likes destrua o ranking;
    - ainda recompensa crescimento real;
    - reduz incentivo a spam.
  */
  return this.normalizeScore(Math.round(Math.log1p(weightedEngagement) * 18));
}

  private calculateRankingScore(score: IPhotoPublicationScore): number {
    const quality = this.normalizeScore(score.qualityScore);
    const engagement = this.normalizeScore(score.engagementScore);
    const safety = this.normalizeScore(score.safetyScore);

    /*
      Ranking inicial:
      - segurança pesa bastante;
      - engajamento positivo ajuda;
      - qualidade evita que só curtida mande no ranking.
    */
    return this.normalizeScore(
      Math.round(
        quality * 0.25 +
        engagement * 0.45 +
        safety * 0.30
      )
    );
  }

  private normalizeScore(value: unknown): number {
    const score = Number(value ?? 0);

    if (!Number.isFinite(score)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}