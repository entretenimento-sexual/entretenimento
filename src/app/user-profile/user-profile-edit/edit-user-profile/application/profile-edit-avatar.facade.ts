import { Injectable, signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import {
  catchError,
  finalize,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';

@Injectable()
export class ProfileEditAvatarFacade {
  readonly isEditing = signal(false);
  readonly isUploading = signal(false);
  readonly progress = signal(0);

  readonly imageAccept = MEDIA_IMAGE_ACCEPT;
  readonly imageFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  readonly avatarMaxMegabytes =
    resolveImageMaxBytes('avatar') / 1024 / 1024;

  constructor(
    private readonly photoEditor: PhotoEditorLauncherService,
    private readonly storageService: StorageService,
    private readonly notify: ErrorNotificationService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  upload$(file: File, uid: string): Observable<string> {
    const safeUid = String(uid ?? '').trim();

    if (
      !safeUid ||
      this.isUploading() ||
      this.isEditing()
    ) {
      return EMPTY;
    }

    const validation = validateImageMediaFile(file, 'avatar');

    if (!validation.valid) {
      this.notify.showError(
        validation.userMessage ??
          'A foto de perfil selecionada não é válida.'
      );
      return EMPTY;
    }

    this.progress.set(0);
    this.isEditing.set(true);

    return this.photoEditor
      .editFile$(file, {
        source: 'profile-avatar',
        context: 'profile-avatar',
        preset: 'avatar-square',
      })
      .pipe(
        take(1),
        switchMap((result) => {
          if (!result) {
            return EMPTY;
          }

          const processedValidation = validateImageMediaFile(
            result.file,
            'avatar'
          );

          if (!processedValidation.valid) {
            this.notify.showError(
              processedValidation.userMessage ??
                'A foto de perfil editada não é válida.'
            );
            return EMPTY;
          }

          return this.uploadProcessed$(result.file, safeUid);
        }),
        catchError((error) => {
          this.report(
            error,
            'ProfileEditAvatarFacade.prepareAvatar',
            'Não foi possível preparar a foto de perfil.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isEditing.set(false);
        })
      );
  }

  private uploadProcessed$(
    file: File,
    uid: string
  ): Observable<string> {
    this.progress.set(0);
    this.isUploading.set(true);

    return this.storageService
      .uploadProfileAvatar(file, uid, (progress: number) => {
        this.progress.set(progress);
      })
      .pipe(
        catchError((error) => {
          this.report(
            error,
            'ProfileEditAvatarFacade.uploadAvatar',
            'Erro durante o upload da foto.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isUploading.set(false);
        })
      );
  }

  private report(
    error: unknown,
    operation: string,
    fallbackMessage: string
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-edit',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'ProfileEditAvatarFacade',
      },
    });
  }
}
