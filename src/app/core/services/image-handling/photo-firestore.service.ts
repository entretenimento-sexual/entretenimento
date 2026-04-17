// src/app/core/services/image-handling/photo-firestore.service.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, catchError, firstValueFrom, lastValueFrom, map, throwError } from 'rxjs';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { StorageService } from './storage.service';

export interface Photo {
  id: string;
  url: string;
  fileName: string;
  createdAt: Date;
  path?: string;
}

export interface PhotoComment {
  id: string;
  comment: string;
  date: Date;
}

export type PhotoUpdateData =
  Partial<Pick<Photo, 'url' | 'fileName' | 'createdAt' | 'path'>> &
  Record<string, unknown>;

@Injectable({
  providedIn: 'root',
})
export class PhotoFirestoreService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly storageService: StorageService,
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
      const photosCollection = collection(this.firestore, `users/${safeUserId}/photos`);

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

  async saveImageState(userId: string, imageStateStr: string): Promise<void> {
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
      'Estado da imagem salvo com sucesso!',
      'Erro ao salvar o estado da imagem.',
      { op: 'saveImageState', userId: safeUserId }
    );
  }

  async countPhotos(userId: string): Promise<number> {
    const safeUserId = this.requireUserId(userId);

    try {
        const snapshot = await lastValueFrom(
          this.firestoreCtx.deferPromise$(() => {
            const photosCollection = collection(this.firestore, `users/${safeUserId}/photos`);
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

  async savePhotoMetadata(userId: string, photo: Photo): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await this.firestoreCtx.run(async () => {
          const photoRef = doc(this.firestore, `users/${safeUserId}/photos/${photo.id}`);
          await setDoc(photoRef, photo);
        });
      },
      'Metadados da foto salvos com sucesso!',
      'Erro ao salvar os metadados da foto.',
      { op: 'savePhotoMetadata', userId: safeUserId, photoId: photo.id }
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
          const photoRef = doc(this.firestore, `users/${safeUserId}/photos/${photoId}`);
          await updateDoc(photoRef, updatedData);
        });
      },
      'Metadados atualizados com sucesso!',
      'Erro ao atualizar os metadados da foto.',
      { op: 'updatePhotoMetadata', userId: safeUserId, photoId }
    );
  }

  async addComment(userId: string, photoId: string, comment: string): Promise<void> {
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
      undefined,
      'Erro ao adicionar o comentário.',
      { op: 'addComment', userId: safeUserId, photoId }
    );
  }

getComments(userId: string, photoId: string): Observable<PhotoComment[]> {
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

  async deletePhoto(userId: string, photoId: string, photoPath: string): Promise<void> {
    const safeUserId = this.requireUserId(userId);

    await this.executeWrite(
      async () => {
        await firstValueFrom(this.storageService.deleteFile(photoPath));

        await this.firestoreCtx.run(async () => {
          const photoRef = doc(this.firestore, `users/${safeUserId}/photos/${photoId}`);
          await deleteDoc(photoRef);
        });
      },
      'Foto e metadados deletados com sucesso!',
      'Erro ao deletar a foto ou metadados.',
      { op: 'deletePhoto', userId: safeUserId, photoId, photoPath }
    );
  }

  private getSafeUserId(userId: string | null | undefined): string | null {
    const normalized = userId?.trim();
    return normalized ? normalized : null;
  }

  private requireUserId(userId: string | null | undefined): string {
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
    const normalizedError = this.normalizeHandledError(error, userMessage, context);

    this.globalErrorHandler.handleError(normalizedError);
    this.errorNotifier.showError(userMessage);

    return throwError(() => normalizedError);
  }

  private async executeWrite(
    action: () => Promise<void>,
    successMessage?: string,
    errorMessage = 'Erro ao executar a operação.',
    context?: Record<string, unknown>
  ): Promise<void> {
    try {
      await action();

      if (successMessage) {
        this.errorNotifier.showSuccess(successMessage);
      }
    } catch (error) {
      const normalizedError = this.normalizeHandledError(error, errorMessage, context);

      this.globalErrorHandler.handleError(normalizedError);
      this.errorNotifier.showError(errorMessage);
      throw normalizedError;
    }
  }

  private normalizeHandledError(
    error: unknown,
    fallbackMessage: string,
    context?: Record<string, unknown>
  ): Error {
    const normalizedError =
      error instanceof Error ? error : new Error(fallbackMessage);

    (normalizedError as any).original = error;
    (normalizedError as any).context = {
      scope: 'PhotoFirestoreService',
      ...(context ?? {}),
    };
    (normalizedError as any).skipUserNotification = true;

    return normalizedError;
  }
} // Linha 282