// src/app/core/services/image-handling/photo-editor-launcher.service.ts
// -----------------------------------------------------------------------------
// PHOTO EDITOR LAUNCHER
// -----------------------------------------------------------------------------
// Porta única para abrir o editor canônico de imagens da plataforma.
// O editor processa a imagem e devolve um resultado puro; o consumidor decide
// posteriormente onde e como persistir o arquivo.
// -----------------------------------------------------------------------------

import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  Observable,
  catchError,
  defer,
  finalize,
  from,
  map,
  of,
  switchMap,
  take,
  throwError,
} from 'rxjs';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import {
  PhotoEditorContext,
  PhotoEditorModalProcessSuccess,
  PhotoEditorPreset,
  PhotoEditorProcessedResult,
} from './photo-editor-result.model';
import {
  PhotoEditorCreateSource,
  PhotoEditorSessionService,
  PhotoEditorSource,
} from './photo-editor-session.service';

export interface PhotoEditorLaunchOptions {
  readonly source?: PhotoEditorCreateSource;
  readonly context?: PhotoEditorContext;
  readonly preset?: PhotoEditorPreset;
}

export interface StoredPhotoEditorLaunchCommand {
  readonly ownerUid: string;
  readonly storedImageUrl: string;
  readonly storedImageState?: string | null;
  readonly fileName?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PhotoEditorLauncherService {
  private readonly modal = inject(NgbModal);
  private readonly document = inject(DOCUMENT);
  private readonly authSession = inject(AuthSessionService);
  private readonly session = inject(PhotoEditorSessionService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  editFile$(
    file: File,
    sourceOrOptions: PhotoEditorCreateSource | PhotoEditorLaunchOptions = 'generic'
  ): Observable<PhotoEditorProcessedResult | null> {
    const options = this.normalizeOptions(sourceOrOptions);

    return this.withAuthenticatedUid$(options.source, (ownerUid) => {
      this.session.setCreateDraft(
        file,
        ownerUid,
        options.source,
        {
          context: options.context,
          preset: options.preset,
        }
      );

      return this.openEditorModal$(options.source);
    });
  }

  editStoredPhoto$(
    command: StoredPhotoEditorLaunchCommand
  ): Observable<PhotoEditorProcessedResult | null> {
    return this.withAuthenticatedUid$('profile-photos', (authenticatedUid) => {
      const ownerUid = String(command.ownerUid ?? '').trim();
      if (!ownerUid || ownerUid !== authenticatedUid) {
        return throwError(() => new Error(
          'A foto só pode ser editada pelo proprietário autenticado.'
        ));
      }

      const storedImageUrl = String(command.storedImageUrl ?? '').trim();
      if (!storedImageUrl) {
        return throwError(() => new Error(
          'A imagem armazenada não possui uma URL válida para edição.'
        ));
      }

      this.session.setEditDraft({
        ownerUid,
        storedImageUrl,
        storedImageState: command.storedImageState ?? null,
        fileName: command.fileName ?? null,
      });

      return this.openEditorModal$('profile-photos');
    });
  }

  private withAuthenticatedUid$(
    source: PhotoEditorSource,
    factory: (uid: string) => Observable<PhotoEditorProcessedResult | null>
  ): Observable<PhotoEditorProcessedResult | null> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const ownerUid = String(uid ?? '').trim();
        if (!ownerUid) {
          return throwError(() => new Error(
            'Usuário não autenticado para abrir o editor de fotos.'
          ));
        }

        return factory(ownerUid);
      }),
      catchError((error: unknown) => {
        this.reportTechnicalError(error, source);
        return throwError(() => error);
      })
    );
  }

  private openEditorModal$(
    source: PhotoEditorSource
  ): Observable<PhotoEditorProcessedResult | null> {
    return from(import(
      'src/app/photo-editor/photo-editor/photo-editor.component'
    )).pipe(
      switchMap(({ PhotoEditorComponent }) => defer(() => {
        const focusOrigin = this.resolveFocusOrigin();
        this.releaseFocusBeforeModal();

        const modalRef = this.modal.open(PhotoEditorComponent, {
          size: 'xl',
          centered: true,
          backdrop: 'static',
          keyboard: false,
          scrollable: true,
          ariaLabelledBy: 'photo-editor-title',
          windowClass: 'photo-editor-modal-window',
        });

        return from(modalRef.result).pipe(
          map((payload: unknown) => {
            const result = payload as PhotoEditorModalProcessSuccess | null;
            return result?.reason === 'processSuccess'
              ? result.result
              : null;
          }),
          catchError((reason: unknown) =>
            this.isExpectedDismiss(reason)
              ? of(null)
              : throwError(() => reason)
          ),
          finalize(() => {
            this.session.clearDraft();
            this.restoreFocusAfterModal(focusOrigin);
          })
        );
      })),
      catchError((error: unknown) => {
        this.session.clearDraft();
        this.reportTechnicalError(error, source);
        return throwError(() => error);
      })
    );
  }

  private normalizeOptions(
    sourceOrOptions: PhotoEditorCreateSource | PhotoEditorLaunchOptions
  ): Required<Pick<PhotoEditorLaunchOptions, 'source'>> & PhotoEditorLaunchOptions {
    return typeof sourceOrOptions === 'string'
      ? { source: sourceOrOptions }
      : {
          ...sourceOrOptions,
          source: sourceOrOptions.source ?? 'generic',
        };
  }

  private resolveFocusOrigin(): HTMLElement | null {
    const activeElement = this.document.activeElement;
    return activeElement instanceof HTMLElement
      && activeElement !== this.document.body
      ? activeElement
      : null;
  }

  private releaseFocusBeforeModal(): void {
    const activeElement = this.document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && activeElement !== this.document.body
    ) {
      activeElement.blur();
    }
  }

  private restoreFocusAfterModal(focusOrigin: HTMLElement | null): void {
    if (!focusOrigin) return;
    setTimeout(() => {
      if (
        focusOrigin.isConnected
        && !focusOrigin.hasAttribute('disabled')
      ) {
        focusOrigin.focus({ preventScroll: true });
      }
    }, 0);
  }

  private isExpectedDismiss(reason: unknown): boolean {
    return reason === 'close'
      || reason === 'dismiss'
      || reason === 0
      || reason === 1;
  }

  private reportTechnicalError(
    error: unknown,
    source: PhotoEditorSource
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error(String(error ?? 'Falha no editor de fotos.'));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'PhotoEditorLauncherService',
        op: 'editImage',
        source,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Diagnóstico secundário não altera o resultado do editor.
    }
  }
}
