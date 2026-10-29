// src/app/core/services/image-handling/photo-upload-flow.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { AuthSessionService } from '../autentication/auth/auth-session.service';

import { StorageService } from './storage.service';
import { PhotoFirestoreService } from './photo-firestore.service';
import { PhotoStorageLifecycleService } from './photo-storage-lifecycle.service';
import { PhotoPublishedSynchronizationService } from './photo-published-synchronization.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';

export interface IPhotoUploadFlowCommand {
  userId: string;
  processedFile: Blob;
  originalFileName: string;
  mimeType: string;
  imageStateStr?: string;
  publishToFeed?: boolean;
}

export interface IPhotoReplaceFlowCommand extends IPhotoUploadFlowCommand {
  photoId: string;
  currentStoragePath: string;
}

export interface IPhotoFlowResult {
  photoId: string;
  url: string;
  path: string;
  fileName: string;
  createdAt: Date;
}

export interface IPhotoUploadProgressEvent {
  type: 'progress';
  progress: number;
}

export interface IPhotoUploadSuccessEvent {
  type: 'success';
  result: IPhotoFlowResult;
}

export type IPhotoUploadFlowEvent =
  | IPhotoUploadProgressEvent
  | IPhotoUploadSuccessEvent;

/**
 * DIRETRIZ DE PRODUTO MEDIA V1 - ARQUIVO UNICO
 *
 * 1. O usuario escolhe uma foto e pode edita-la localmente ou nao.
 * 2. Somente o arquivo final resultante deve ser enviado ao backend.
 * 3. A plataforma NAO guarda o original anterior a edicao.
 * 4. A plataforma NAO guarda historico ou versoes de edicao.
 * 5. Uma foto publicada deve ter uma unica copia fisica persistente.
 * 6. Uploads temporarios devem ser eliminados apos a publicacao.
 * 7. Uploads abandonados ou com falha exigem limpeza recuperavel.
 *
 * EDICAO DE FOTO JA PUBLICADA:
 * - O usuario pode carregar a propria foto publicada no editor.
 * - A edicao ocorre localmente, usando a imagem publicada atual.
 * - Somente o novo resultado final e enviado como substituicao.
 * - A imagem anterior e excluida apos a troca segura.
 * - Uma coexistencia temporaria e permitida durante essa troca.
 *
 * BACKEND:
 * - Mantem identidade, autorizacao, metadados e assetVersion atual.
 * - assetVersion nao significa armazenar historico de arquivos.
 * - Mantem validacao tecnica e URLs temporarias autorizadas.
 * - Retencao adicional somente por obrigacao excepcional.
 * - Nao oferece biblioteca ou galeria privada gratuita.
 *
 * MODERACAO:
 * - Nudez adulta e sexo explicito consensual sao permitidos.
 * - Moderacao inicial por denuncias; sem fila humana preventiva.
 * - IA para conteudo criminoso e borramento facial sao futuros.
 *
 * ATENCAO: POLITICA ALVO, AINDA NAO TOTALMENTE IMPLEMENTADA.
 * O codigo atual usa origem tecnica privada, copia publicada
 * e saveImageStateBestEffort$ no backend. Esses contratos devem
 * ser adaptados e testados antes da limpeza das origens.
 */
@Injectable({
  providedIn: 'root',
})
export class PhotoUploadFlowService {
  constructor(
    private readonly storageService: StorageService,
    private readonly photoFirestoreService: PhotoFirestoreService,
    private readonly photoStorageLifecycle: PhotoStorageLifecycleService,
    private readonly publishedSync: PhotoPublishedSynchronizationService,
    private readonly errorHandler: MediaApplicationErrorService,
    private readonly authSession: AuthSessionService,
  ) {}

  private ownerSessionEnded$(userId: string): Observable<string | null> {
    return this.authSession.uid$.pipe(filter((uid) => uid !== userId));
  }

  uploadProcessedPhoto$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
    const resultBase = {
      photoId: this.createPhotoId(),
      fileName,
      createdAt: new Date(),
    };

    return this.uploadNewPhotoBinary$(
      safeUserId,
      file,
      requestedStoragePath
    ).pipe(
      switchMap(({ displayUrl, storagePath, reservationId }) => {
        const result: IPhotoFlowResult = {
          ...resultBase,
          url: displayUrl,
          path: storagePath,
        };

        return this.persistNewPhoto$(
          safeUserId,
          result,
          reservationId,
          command.publishToFeed === true
        );
      }),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao enviar a imagem.',
          {
            op: 'uploadProcessedPhoto$',
            userId: safeUserId,
            fileName,
          }
        )
      ),
      takeUntil(this.ownerSessionEnded$(safeUserId))
    );
  }

  replaceProcessedPhoto$(
    command: IPhotoReplaceFlowCommand
  ): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const safePhotoId = this.normalizeRequiredString(
      command.photoId,
      'Foto inválida para edição.'
    );
    const safeCurrentStoragePath = this.normalizeRequiredString(
      command.currentStoragePath,
      'O fluxo de edição precisa do storagePath da foto.'
    );
    const currentStoragePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        safeUserId,
        safeCurrentStoragePath
      );

    if (!currentStoragePath) {
      return this.failFlow$(
        new Error('O fluxo de edição recebeu um storagePath inválido.'),
        'Não foi possível editar a foto selecionada.',
        {
          op: 'replaceProcessedPhoto$',
          userId: safeUserId,
          photoId: safePhotoId,
          hasStoragePath: !!safeCurrentStoragePath,
        }
      );
    }

    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);

    /**
     * A substituição usa copy-on-write:
     * 1) envia um novo objeto;
     * 2) registra a origem temporária e aguarda a Function publicar a
     *    versão final sanitizada de maneira atômica;
     * 3) só depois tenta limpar a origem antiga.
     *
     * Apenas registrar o upload privado não confirma a troca publicada.
     * Em falha de sincronização, não apagar a origem anterior.
     */
    return this.uploadNewPhotoBinary$(
      safeUserId,
      file,
      requestedStoragePath
    ).pipe(
      switchMap(({ displayUrl, storagePath, reservationId }) => {
        const result: IPhotoFlowResult = {
          photoId: safePhotoId,
          url: displayUrl,
          path: storagePath,
          fileName,
          createdAt: new Date(),
        };

        return from(
          this.photoFirestoreService.updatePhotoMetadata(
            safeUserId,
            safePhotoId,
            {
              path: storagePath,
              fileName,
            },
            reservationId
          )
        ).pipe(
          // Uma falha do commit privado nao pode parecer sucesso. Erros de
          // sincronizacao posteriores nao entram no rollback do novo arquivo.
          catchError((metadataError) =>
            this.rollbackUploadedPhoto$(
              safeUserId,
              storagePath,
              metadataError,
              'replace-metadata-failed'
            )
          ),
          switchMap(() => this.publishedSync.waitForPublishedReplacement$(
            safeUserId,
            safePhotoId,
            storagePath
          )),
          switchMap(() =>
            this.deletePhotoObjectBestEffort$(
              safeUserId,
              currentStoragePath,
              'cleanup-replaced-photo-confirmed'
            )
          ),
          map(() => result)
        );
      }),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao atualizar a imagem.',
          {
            op: 'replaceProcessedPhoto$',
            userId: safeUserId,
            photoId: safePhotoId,
            fileName,
          }
        )
      ),
      takeUntil(this.ownerSessionEnded$(safeUserId))
    );
  }

  uploadProcessedPhotoWithProgress$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoUploadFlowEvent> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
    const resultBase = {
      photoId: this.createPhotoId(),
      fileName,
      createdAt: new Date(),
    };

    return new Observable<IPhotoUploadFlowEvent>((observer) => {
      observer.next({ type: 'progress', progress: 0 });

      const subscription = this.uploadNewPhotoBinary$(
        safeUserId,
        file,
        requestedStoragePath,
        (progress) => {
          observer.next({
            type: 'progress',
            progress,
          });
        }
      ).pipe(
        switchMap(({ displayUrl, storagePath, reservationId }) => {
          const result: IPhotoFlowResult = {
            ...resultBase,
            url: displayUrl,
            path: storagePath,
          };

          return this.persistNewPhoto$(
            safeUserId,
            result,
            reservationId,
            command.publishToFeed === true
          );
        }),
        catchError((error) =>
          this.failFlow$(
            error,
            'Erro ao enviar a imagem.',
            {
              op: 'uploadProcessedPhotoWithProgress$',
              userId: safeUserId,
              fileName,
            }
          )
        )
      ).subscribe({
        next: (result) => {
          observer.next({ type: 'progress', progress: 100 });
          observer.next({ type: 'success', result });
          observer.complete();
        },
        error: (error) => observer.error(error),
      });

      return () => subscription.unsubscribe();
    }).pipe(takeUntil(this.ownerSessionEnded$(safeUserId)));
  }

  private uploadNewPhotoBinary$(
    userId: string,
    file: File,
    requestedStoragePath: string,
    progressCallback?: (progress: number) => void
  ): Observable<{
    displayUrl: string;
    storagePath: string;
    reservationId: string;
  }> {
    const storagePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        userId,
        requestedStoragePath
      );

    if (!storagePath) {
      return throwError(() =>
        this.createError(
          'media/invalid-upload-path',
          'O upload foi iniciado sem um caminho de armazenamento válido.'
        )
      );
    }

    return this.storageService.uploadOwnedPhotoFile(
      file,
      storagePath,
      userId,
      progressCallback
    ).pipe(
      switchMap(({ location, reservationId }) =>
        this.resolveDisplayUrl$(storagePath, location).pipe(
          map((displayUrl) => ({
            displayUrl,
            storagePath,
            reservationId,
          }))
        )
      )
    );
  }

  private persistNewPhoto$(
    userId: string,
    result: IPhotoFlowResult,
    reservationId: string,
    publishToFeed = false
  ): Observable<IPhotoFlowResult> {
    return from(
      this.photoFirestoreService.savePhotoMetadata(
        userId,
        {
          id: result.photoId,
          url: result.url,
          path: result.path,
          fileName: result.fileName,
          createdAt: result.createdAt,
        },
        reservationId,
        publishToFeed
      )
    ).pipe(

      map(() => result),
      catchError((metadataError) =>
        this.rollbackUploadedPhoto$(
          userId,
          result.path,
          metadataError,
          'create-metadata-failed'
        )
      )
    );
  }

  private resolveDisplayUrl$(
    storagePath: string,
    location: string
  ): Observable<string> {
    const safeLocation = String(location ?? '').trim();

    if (this.isHttpUrl(safeLocation)) {
      return of(safeLocation);
    }

    return this.storageService.getPhotoUrl(storagePath).pipe(
      switchMap((resolvedUrl) => {
        const displayUrl = String(resolvedUrl ?? '').trim();

        if (!this.isHttpUrl(displayUrl)) {
          return throwError(() =>
            this.createError(
              'media/photo-url-unavailable',
              'A foto foi enviada, mas não pôde ser carregada com segurança.'
            )
          );
        }

        return of(displayUrl);
      })
    );
  }

  private rollbackUploadedPhoto$(
    userId: string,
    storagePath: string,
    originalError: unknown,
    reason: string
  ): Observable<never> {
    return this.deletePhotoObjectBestEffort$(
      userId,
      storagePath,
      reason
    ).pipe(
      switchMap(() => throwError(() => originalError))
    );
  }

  private deletePhotoObjectBestEffort$(
    userId: string,
    storagePath: string,
    reason: string
  ): Observable<void> {
    return this.photoStorageLifecycle
      .deleteOwnedPrivatePhoto$(userId, storagePath)
      .pipe(
        catchError((cleanupError) => {
          this.reportSilent(cleanupError, {
            op: 'deletePhotoObjectBestEffort$',
            userId,
            reason,
            hasStoragePath: !!String(storagePath ?? '').trim(),
          });
          return of(void 0);
        })
      );
  }

  private buildProcessedFile(
    command: IPhotoUploadFlowCommand,
    fileName: string
  ): File {
    return new File([command.processedFile], fileName, {
      type: command.mimeType || 'image/jpeg',
      lastModified: Date.now(),
    });
  }

  private buildTimestampedFileName(originalFileName: string): string {
    const safeOriginalName = String(originalFileName ?? '').trim() || 'photo.jpg';
    return `${Date.now()}_${safeOriginalName}`;
  }

  private createPhotoId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private normalizeRequiredString(value: string, message: string): string {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      throw new Error(message);
    }

    return normalized;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private reportSilent(
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorHandler.reportSilently(
        error,
        String(context?.['op'] ?? 'secondaryFailure'),
        'Falha secundária no fluxo de upload de foto.',
        {
          scope: 'PhotoUploadFlowService',
          ...(context ?? {}),
        }
      );
    } catch {
      // noop
    }
  }

  private failFlow$(
    error: unknown,
    userMessage: string,
    context?: Record<string, unknown>
  ): Observable<never> {
    this.errorHandler.report(error, {
      operation: String(context?.['op'] ?? 'flowFailure'),
      fallbackMessage: userMessage,
      metadata: {
        scope: 'PhotoUploadFlowService',
        ...(context ?? {}),
      },
    });

    return throwError(() =>
      error instanceof Error ? error : new Error(userMessage)
    );
  }
}
