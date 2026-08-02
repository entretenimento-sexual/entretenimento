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
  sizeBytes?: number | null;
  draftExpiresAt?: number | null;
}

export interface PhotoComment {
  id: string;
  comment: string;
  date: Date;
}

export type PhotoUpdateData =
  Partial<
    Pick<
      Photo,
      'url' | 'fileName' | 'createdAt' | 'displayDate' | 'path' | 'sizeBytes'
    >
  > & Record<string, unknown>;

interface DeleteProfilePhotoCallableRequest {
  ownerUid: string;
  photoId: string;
}

interface DeleteProfilePhotoCallableResponse {
  photoId: string;
  cleanupPending: boolean;
}

interface RegisterPrivatePhotoUploadRequest {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
}

export interface RegisterPrivatePhotoUploadResponse {
  photoId: string;
  ownerUid: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
  draftExpiresAt: number;
}

interface ReplacePrivatePhotoUploadRequest {
  ownerUid: string;
  photoId: string;
  currentStoragePath: string;
  newStoragePath: string;
  newDisplayUrl: string;
  fileName: string;
  sizeBytes: number;
}

export interface ReplacePrivatePhotoUploadResponse {
  photoId: string;
  ownerUid: string;
  previousStoragePath: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: number;
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

  async registerPrivatePhotoUpload(
    userId: string,
    photo: Photo
  ): Promise<RegisterPrivatePhotoUploadResponse> {
    const safeUserId = this.requireUserId(userId);
    const safePhotoId = String(photo.id ?? '').trim();
    const safeStoragePath = String(photo.path ?? '').trim();
    const safeDisplayUrl = String(photo.url ?? '').trim();
    const sizeBytes = Number(photo.sizeBytes ?? 0);

    if (!safePhotoId || !safeStoragePath || !safeDisplayUrl || sizeBytes <= 0) {
      throw this.normalizeHandledError(
        new Error('Os dados da foto enviada estão incompletos.'),
        'Os dados da foto enviada estão incompletos.',
        {
          op: 'registerPrivatePhotoUpload',
          userId: safeUserId,
          photoId: safePhotoId,
        }
      );
    }

    return this.executeCallable(
      'registerPrivatePhotoUpload',
      {
        ownerUid: safeUserId,
        photoId: safePhotoId,
        storagePath: safeStoragePath,
        displayUrl: safeDisplayUrl,
        fileName: photo.fileName,
        sizeBytes: Math.trunc(sizeBytes),
        createdAt: photo.createdAt.getTime(),
      } satisfies RegisterPrivatePhotoUploadRequest,
      'Não foi possível registrar a foto enviada.',
      {
        op: 'registerPrivatePhotoUpload',
        userId: safeUserId,
        photoId: safePhotoId,
      }
    );
  }

  async replacePrivatePhotoUpload(
    userId: string,
    photoId: string,
    currentStoragePath: string,
    replacement: Pick<Photo, 'url' | 'path' | 'fileName' | 'sizeBytes'>
  ): Promise<ReplacePrivatePhotoUploadResponse> {
    const safeUserId = this.requireUserId(userId);
    const safePhotoId = String(photoId ?? '').trim();
    const safeCurrentStoragePath = String(currentStoragePath ?? '').trim();
    const safeNewStoragePath = String(replacement.path ?? '').trim();
    const safeDisplayUrl = String(replacement.url ?? '').trim();
    const sizeBytes = Number(replacement.sizeBytes ?? 0);

    if (
      !safePhotoId ||
      !safeCurrentStoragePath ||
      !safeNewStoragePath ||
      !safeDisplayUrl ||
      sizeBytes <= 0
    ) {
      throw this.normalizeHandledError(
        new Error('Os dados da substituição estão incompletos.'),
        'Os dados da substituição estão incompletos.',
        {
          op: 'replacePrivatePhotoUpload',
          userId: safeUserId,
          photoId: safePhotoId,
        }
      );
    }

    return this.executeCallable(
      'replacePrivatePhotoUpload',
      {
        ownerUid: safeUserId,
        photoId: safePhotoId,
        currentStoragePath: safeCurrentStoragePath,
        newStoragePath: safeNewStoragePath,
        newDisplayUrl: safeDisplayUrl,
        fileName: replacement.fileName,
        sizeBytes: Math.trunc(sizeBytes),
      } satisfies ReplacePrivatePhotoUploadRequest,
      'Não foi possível substituir a foto.',
      {
        op: 'replacePrivatePhotoUpload',
        userId: safeUserId,
        photoId: safePhotoId,
      }
    );
  }

  /**
   * Mantido apenas para compatibilidade de chamadas internas antigas.
   * Novos uploads usam `registerPrivatePhotoUpload`, que reserva quota no backend.
   */
  async savePhotoMetadata(
    userId: string,
    photo: Photo
  ): Promise<void> {
    await this.registerPrivatePhotoUpload(userId, photo);
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
        await this.firestoreCtx.run(() => {
          const callable = httpsCallable<
            DeleteProfilePhotoCallableRequest,
            DeleteProfilePhotoCallableResponse
          >(this.functions, 'deleteProfilePhoto');

          return callable({
            ownerUid: safeUserId,
            photoId: safePhotoId,
          }).then(() => undefined);
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

  private async executeCallable<Request, Response>(
    callableName: string,
    payload: Request,
    fallbackMessage: string,
    context?: Record<string, unknown>
  ): Promise<Response> {
    try {
      return await this.firestoreCtx.run(async () => {
        const callable = httpsCallable<Request, Response>(
          this.functions,
          callableName
        );
        const response = await callable(payload);
        return response.data;
      });
    } catch (error) {
      const normalizedError = this.normalizeHandledError(
        error,
        fallbackMessage,
        context
      );

      this.globalErrorHandler.handleError(normalizedError);
      throw normalizedError;
    }
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
