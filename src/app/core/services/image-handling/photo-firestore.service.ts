// src/app/core/services/image-handling/photo-firestore.service.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  catchError,
  lastValueFrom,
  map,
  throwError,
} from 'rxjs';

import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

export interface Photo {
  id: string;
  url: string;
  fileName: string;
  createdAt: Date;
  displayDate?: number | null;
  path?: string;
}

export interface PhotoComment {
  id: string;
  comment: string;
  date: Date;
}

export type PhotoUpdateData =
  Partial<Pick<Photo, 'url' | 'fileName' | 'createdAt' | 'displayDate' | 'path'>> &
  Record<string, unknown>;

interface DeleteProfilePhotoCallableRequest {
  ownerUid: string;
  photoId: string;
}

interface DeleteProfilePhotoCallableResponse {
  photoId: string;
  cleanupPending: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PhotoFirestoreService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly firestoreCtx: FirestoreContextService,
  ) {}

  getPhotosByUser(userId: string): Observable<Photo[]> {
    const safeUserId = this.getSafeUserId(userId);

    if (!safeUserId) {
      return this.handleReadError<Photo[]>(
        new Error('Usuário não autenticado.'),
        'Usuário não autenticado.',
        { op: 'getPhotosByUser', userId }
      );
    }

    return this.firestoreCtx.deferObservable$(() => {
      const photosCollection = collection(
        this.firestore,
        `users/${safeUserId}/photos`
      );

      return collectionData(photosCollection, { idField: 'id' }).pipe(
        map((photos) => photos as Photo[])
      );
    }).pipe(
      catchError((error) =>
        this.handleReadError<Photo[]>(
          error,
          'Erro ao carregar as fotos.',
          { op: 'getPhotosByUser', userId: safeUserId }
        )
      )
    );
  }

  async saveImageState(
    userId: string,
    imageStateStr: string
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await this.firestoreCtx.run(async () => {
          const imageStateRef = doc(
            this.firestore,
            `users/${safeUserId}/imageStates/${Date.now()}`
          );

          await setDoc(imageStateRef, { imageState: imageStateStr });
        });
      },
      'Erro ao salvar o estado da imagem.',
      { op: 'saveImageState', userId: safeUserId }
    );
  }

  async countPhotos(userId: string): Promise<number> {
    const safeUserId = this.requireUserId(userId);

    try {
      const snapshot = await lastValueFrom(
        this.firestoreCtx.deferPromise$(() => {
          const photosCollection = collection(
            this.firestore,
            `users/${safeUserId}/photos`
          );
          return getDocs(photosCollection);
        })
      );

      return snapshot.size;
    } catch (error) {
      const normalizedError = this.normalizeHandledError(
        error,
        'Erro ao contar as fotos.',
        { op: 'countPhotos', userId: safeUserId }
      );

      this.globalErrorHandler.handleError(normalizedError);
      this.errorNotifier.showError('Erro ao contar as fotos.');
      throw normalizedError;
    }
  }

  async savePhotoMetadata(
    userId: string,
    photo: Photo
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await this.firestoreCtx.run(async () => {
          const photoRef = doc(
            this.firestore,
            `users/${safeUserId}/photos/${photo.id}`
          );
          await setDoc(photoRef, photo);
        });
      },
      'Erro ao salvar os metadados da foto.',
      {
        op: 'savePhotoMetadata',
        userId: safeUserId,
        photoId: photo.id,
      }
    );
  }

  async updatePhotoMetadata(
    userId: string,
    photoId: string,
    updatedData: PhotoUpdateData
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await this.firestoreCtx.run(async () => {
          const photoRef = doc(
            this.firestore,
            `users/${safeUserId}/photos/${photoId}`
          );
          await updateDoc(photoRef, updatedData);
        });
      },
      'Erro ao atualizar os metadados da foto.',
      {
        op: 'updatePhotoMetadata',
        userId: safeUserId,
        photoId,
      }
    );
  }

  async updatePhotoDisplayDate(
    userId: string,
    photoId: string,
    displayDate: number | null
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);
    const safePhotoId = photoId?.trim();

    if (!safePhotoId) {
      throw this.normalizeHandledError(
        new Error('Foto inválida.'),
        'Foto inválida.',
        { op: 'updatePhotoDisplayDate', userId: safeUserId, photoId }
      );
    }

    const normalizedDisplayDate = this.normalizeDisplayDate(displayDate);

    await this.updatePhotoMetadata(safeUserId, safePhotoId, {
      displayDate: normalizedDisplayDate,
      updatedAt: new Date(),
    });
  }

  async addComment(
    userId: string,
    photoId: string,
    comment: string
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await this.firestoreCtx.run(async () => {
          const commentsRef = doc(
            this.firestore,
            `users/${safeUserId}/photos/${photoId}/comments/${Date.now()}`
          );

          await setDoc(commentsRef, {
            comment,
            date: new Date(),
          });
        });
      },
      'Erro ao adicionar o comentário.',
      { op: 'addComment', userId: safeUserId, photoId }
    );
  }

  getComments(
    userId: string,
    photoId: string
  ): Observable<PhotoComment[]> {
    const safeUserId = this.getSafeUserId(userId);

    if (!safeUserId) {
      return this.handleReadError<PhotoComment[]>(
        new Error('Usuário não autenticado.'),
        'Usuário não autenticado.',
        { op: 'getComments', userId, photoId }
      );
    }

    return this.firestoreCtx.deferObservable$(() => {
      const commentsCollection = collection(
        this.firestore,
        `users/${safeUserId}/photos/${photoId}/comments`
      );

      return collectionData(commentsCollection, { idField: 'id' }).pipe(
        map((comments) => comments as PhotoComment[])
      );
    }).pipe(
      catchError((error) =>
        this.handleReadError<PhotoComment[]>(
          error,
          'Erro ao carregar os comentários.',
          { op: 'getComments', userId: safeUserId, photoId }
        )
      )
    );
  }

  async deletePhoto(
    userId: string,
    photoId: string,
    _photoPath: string
  ): Promise<void> {
    const safeUserId = this.requireUserId(userId);
    const safePhotoId = String(photoId ?? '').trim();

    if (!safePhotoId) {
      throw this.normalizeHandledError(
        new Error('Foto inválida para exclusão.'),
        'Foto inválida para exclusão.',
        { op: 'deletePhoto', userId: safeUserId, photoId }
      );
    }

    await this.executeWrite(
      async () => {
        const callable = httpsCallable<
          DeleteProfilePhotoCallableRequest,
          DeleteProfilePhotoCallableResponse
        >(this.functions, 'deleteProfilePhoto');

        await callable({
          ownerUid: safeUserId,
          photoId: safePhotoId,
        });
      },
      'Erro ao excluir a foto.',
      {
        op: 'deletePhoto',
        userId: safeUserId,
        photoId: safePhotoId,
      }
    );
  }

  private normalizeDisplayDate(value: number | null): number | null {
    if (value === null) {
      return null;
    }

    if (!Number.isFinite(value) || value < 0) {
      return null;
    }

    const maxSupportedDate = new Date(
      '2100-12-31T23:59:59.999Z'
    ).getTime();
    return Math.min(Math.trunc(value), maxSupportedDate);
  }

  private getSafeUserId(
    userId: string | null | undefined
  ): string | null {
    const normalized = userId?.trim();
    return normalized ? normalized : null;
  }

  private requireUserId(
    userId: string | null | undefined
  ): string {
    const safeUserId = this.getSafeUserId(userId);

    if (!safeUserId) {
      const error = this.normalizeHandledError(
        new Error('Usuário não autenticado.'),
        'Usuário não autenticado.',
        { op: 'requireUserId', userId }
      );

      this.globalErrorHandler.handleError(error);
      throw error;
    }

    return safeUserId;
  }

  private handleReadError<T>(
    error: unknown,
    userMessage: string,
    context?: Record<string, unknown>
  ): Observable<T> {
    const normalizedError = this.normalizeHandledError(
      error,
      userMessage,
      context
    );

    this.globalErrorHandler.handleError(normalizedError);
    this.errorNotifier.showError(userMessage);

    return throwError(() => normalizedError);
  }

  /**
   * Escritas de baixo nível não exibem toast de sucesso ou erro.
   * A camada de fluxo/componente possui o contexto necessário para comunicar
   * o resultado final sem mensagens duplicadas ou sucesso parcial.
   */
  private async executeWrite(
    action: () => Promise<void>,
    errorMessage = 'Erro ao executar a operação.',
    context?: Record<string, unknown>
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const normalizedError = this.normalizeHandledError(
        error,
        errorMessage,
        context
      );

      this.globalErrorHandler.handleError(normalizedError);
      throw normalizedError;
    }
  }

  private normalizeHandledError(
    error: unknown,
    fallbackMessage: string,
    context?: Record<string, unknown>
  ): Error {
    const normalizedError = error instanceof Error
      ? error
      : new Error(fallbackMessage);

    (normalizedError as any).original = error;
    (normalizedError as any).context = {
      scope: 'PhotoFirestoreService',
      ...(context ?? {}),
    };
    (normalizedError as any).skipUserNotification = true;

    return normalizedError;
  }
}
