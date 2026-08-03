// src/app/core/services/media/media-publication.service.ts
// Serviço da camada segura de publicação.
//
// Objetivo:
// - manter o staging técnico separado da projeção pública;
// - ler configuração privada de publicação;
// - solicitar publicação, compatibilidade legada e capa via Cloud Functions;
// - registrar visualização pública por backend confiável;
// - manter Observable na API pública;
// - impedir escrita direta do cliente na projeção pública.
//
// Regra de produto:
// - toda nova foto enviada segue para publicação pública;
// - comentários e reações começam habilitados;
// - o método de despublicação permanece apenas para compatibilidade legada.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';
import {
  IPhotoPublicationConfig,
  TPhotoCommentsPolicy,
  TPhotoVisibility,
} from 'src/app/core/interfaces/media/i-photo-publication-config';

const MAX_PUBLICATION_CAPTION_LENGTH = 800;

export interface IPublishPhotoCommand {
  ownerUid: string;
  photo: IPhotoItem;
  visibility: Exclude<TPhotoVisibility, 'PRIVATE'>;
  caption?: string | null;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  commentsPolicy?: TPhotoCommentsPolicy;
  reactionsEnabled?: boolean;
}

type TRecordPhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

interface PublishPhotoCallableRequest {
  ownerUid: string;
  photoId: string;
  visibility: Exclude<TPhotoVisibility, 'PRIVATE'>;
  caption: string | null;
  isCover: boolean;
  orderIndex: number;
  commentsEnabled: boolean;
  commentsPolicy: TPhotoCommentsPolicy;
  reactionsEnabled: boolean;
}

interface PublishPhotoCallableResponse {
  photoId: string;
  moderationStatus: 'APPROVED';
}

interface PhotoIdCallableRequest {
  ownerUid: string;
  photoId: string;
}

interface RecordPhotoViewCallableRequest {
  ownerUid: string;
  photoId: string;
  source: TRecordPhotoViewSource;
}

@Injectable({ providedIn: 'root' })
export class MediaPublicationService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  getPublicationConfigsByOwner$(
    ownerUid: string
  ): Observable<Record<string, IPhotoPublicationConfig>> {
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      return of({});
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicationCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/photo_publications`
      );

      return collectionData(publicationCollection, {
        idField: 'photoId',
      }) as Observable<IPhotoPublicationConfig[]>;
    }).pipe(
      map((items) =>
        items.reduce<Record<string, IPhotoPublicationConfig>>((acc, item) => {
          const safePhotoId = (item.photoId ?? '').trim();
          if (!safePhotoId) {
            return acc;
          }

          acc[safePhotoId] = {
            photoId: safePhotoId,
            ownerUid: item.ownerUid,
            isPublished: !!item.isPublished,
            visibility: item.visibility ?? 'PRIVATE',
            caption: this.normalizeCaption(item.caption),

            isCover: !!item.isCover,
            orderIndex: item.orderIndex ?? 0,

            commentsEnabled: item.commentsEnabled ?? true,
            commentsPolicy: item.commentsPolicy ?? 'EVERYONE',
            commentsCount: item.commentsCount ?? 0,

            reactionsEnabled: item.reactionsEnabled ?? true,
            reactionsCount: item.reactionsCount ?? 0,

            moderationStatus: item.moderationStatus ?? 'PRIVATE',
            moderationReason: item.moderationReason ?? null,
            reportsCount: item.reportsCount ?? 0,

            score: item.score ?? 0,
            scoreBreakdown: item.scoreBreakdown ?? {
              rankingScore: 0,
              qualityScore: 0,
              engagementScore: 0,
              safetyScore: 100,
            },

            publishedAt: item.publishedAt ?? null,
            updatedAt: item.updatedAt,
            lastModeratedAt: item.lastModeratedAt ?? null,
          };

          return acc;
        }, {})
      ),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar configuração de publicação das fotos.',
          error,
          { op: 'getPublicationConfigsByOwner$', ownerUid: safeOwnerUid },
          true
        );
        return of({});
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  buildDefaultConfig(
    ownerUid: string,
    photoId: string
  ): IPhotoPublicationConfig {
    return {
      photoId,
      ownerUid,

      isPublished: false,
      visibility: 'PRIVATE',
      caption: null,

      isCover: false,
      orderIndex: 0,

      commentsEnabled: true,
      commentsPolicy: 'EVERYONE',
      commentsCount: 0,

      reactionsEnabled: true,
      reactionsCount: 0,

      moderationStatus: 'PRIVATE',
      moderationReason: null,
      reportsCount: 0,

      score: 0,
      scoreBreakdown: {
        rankingScore: 0,
        qualityScore: 0,
        engagementScore: 0,
        safetyScore: 100,
      },

      publishedAt: null,
      updatedAt: Date.now(),
      lastModeratedAt: null,
    };
  }

  publishPhoto$(command: IPublishPhotoCommand): Observable<void> {
    const safeOwnerUid = (command.ownerUid ?? '').trim();
    const safePhotoId = (command.photo?.id ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        PublishPhotoCallableRequest,
        PublishPhotoCallableResponse
      >(this.functions, 'publishPhoto');

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        visibility: command.visibility,
        caption: this.normalizeCaption(command.caption),
        isCover: !!command.isCover,
        orderIndex: command.orderIndex ?? 0,
        commentsEnabled: command.commentsEnabled ?? true,
        commentsPolicy: command.commentsPolicy ?? 'EVERYONE',
        reactionsEnabled: command.reactionsEnabled ?? true,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao publicar a foto.',
          error,
          {
            op: 'publishPhoto$',
            ownerUid: safeOwnerUid,
            photoId: safePhotoId,
          },
          true
        );

        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Compatibilidade com rotinas administrativas e registros antigos.
   * A experiência normal remove fotos por exclusão definitiva.
   */
  unpublishPhoto$(ownerUid: string, privatePhotoId: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (privatePhotoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<PhotoIdCallableRequest, { photoId: string }>(
        this.functions,
        'unpublishPhoto'
      );

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao executar compatibilidade de despublicação da foto.',
          error,
          {
            op: 'unpublishPhoto$',
            ownerUid: safeOwnerUid,
            privatePhotoId: safePhotoId,
          },
          true
        );

        return throwError(() => error);
      })
    );
  }

  setCoverPhoto$(ownerUid: string, privatePhotoId: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (privatePhotoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<PhotoIdCallableRequest, { photoId: string }>(
        this.functions,
        'setCoverPhoto'
      );

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao definir foto principal.',
          error,
          {
            op: 'setCoverPhoto$',
            ownerUid: safeOwnerUid,
            privatePhotoId: safePhotoId,
          },
          true
        );

        return throwError(() => error);
      })
    );
  }

  recordPhotoView$(
    ownerUid: string,
    photoId: string,
    source: TRecordPhotoViewSource = 'profile'
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordPhotoViewCallableRequest,
        { ok: true }
      >(this.functions, 'recordPhotoView');

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        source,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao registrar visualização da foto.',
          error,
          {
            op: 'recordPhotoView$',
            ownerUid: safeOwnerUid,
            photoId: safePhotoId,
            source,
          },
          true
        );

        return of(void 0);
      })
    );
  }

  reorderPublishedPhotos$(
    _ownerUid: string,
    _orderedPhotoIds: string[]
  ): Observable<void> {
    this.errorNotifier.showWarning(
      'Reordenação pública ainda será migrada para função segura.'
    );

    return of(void 0);
  }

  private normalizeCaption(value: unknown): string | null {
    const caption = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PUBLICATION_CAPTION_LENGTH);

    return caption || null;
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
        // A notificação não pode quebrar o fluxo.
      }
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(userMessage);

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'MediaPublicationService',
        ...(context ?? {}),
      };
      (normalizedError as any).skipUserNotification = silent;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // A telemetria não pode quebrar o fluxo.
    }
  }
}
