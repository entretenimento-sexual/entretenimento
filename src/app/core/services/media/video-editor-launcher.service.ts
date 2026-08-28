import { Injectable, inject } from '@angular/core';
import {
  Observable,
  defer,
  distinctUntilChanged,
  map,
  of,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { validateVideoMediaFile } from './media-format.policy';
import {
  IVideoEditorState,
  VideoEditorContext,
  VideoEditorProcessedResult,
} from './video-editor-result.model';
import {
  IVideoEditorDraft,
  VideoEditorSessionService,
  VideoEditorSource,
} from './video-editor-session.service';

export interface VideoEditorLaunchOptions {
  readonly source?: VideoEditorSource;
  readonly context?: VideoEditorContext;
}

@Injectable({ providedIn: 'root' })
export class VideoEditorLauncherService {
  private readonly authSession = inject(AuthSessionService);
  private readonly session = inject(VideoEditorSessionService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly draft$ = this.session.draft$;
  readonly state$ = this.session.state$;
  readonly posterBlob$ = this.session.posterBlob$;

  draftForSource$(source: VideoEditorSource): Observable<IVideoEditorDraft | null> {
    return this.draft$.pipe(
      map((draft) => draft?.source === source ? draft : null),
      distinctUntilChanged()
    );
  }

  stateForSource$(source: VideoEditorSource): Observable<IVideoEditorState | null> {
    return this.draftForSource$(source).pipe(
      map((draft) => draft?.state ?? null),
      distinctUntilChanged()
    );
  }

  posterBlobForSource$(source: VideoEditorSource): Observable<Blob | null> {
    return this.draftForSource$(source).pipe(
      map((draft) => draft?.posterBlob ?? null),
      distinctUntilChanged()
    );
  }

  launchFile$(
    file: File,
    options: VideoEditorLaunchOptions = {}
  ): Observable<IVideoEditorDraft> {
    const source = options.source ?? 'generic';

    return defer(() => {
      const validation = validateVideoMediaFile(file);
      if (!validation.valid) {
        return throwError(() => new Error(
          validation.userMessage ?? 'O vídeo selecionado não é válido.'
        ));
      }

      return this.authSession.uid$.pipe(
        take(1),
        switchMap((uid) => {
          const ownerUid = String(uid ?? '').trim();
          if (!ownerUid) {
            return throwError(() => new Error(
              'Usuário não autenticado para abrir o editor de vídeo.'
            ));
          }

          this.session.setDraft(
            file,
            ownerUid,
            source,
            options.context
          );

          const draft = this.session.peekDraft();
          return draft
            ? of(draft)
            : throwError(() => new Error(
                'Não foi possível iniciar a sessão do editor de vídeo.'
              ));
        })
      );
    }).pipe(
      catchError((error: unknown) => {
        this.reportTechnicalError(error, source);
        return throwError(() => error);
      })
    );
  }

  updateState(
    state: IVideoEditorState,
    source?: VideoEditorSource
  ): void {
    if (!this.hasMatchingDraft(source)) {
      return;
    }

    this.session.updateState(state);
  }

  updatePoster(blob: Blob | null, source?: VideoEditorSource): void {
    if (!this.hasMatchingDraft(source)) {
      return;
    }

    this.session.updatePoster(blob);
  }

  complete(source?: VideoEditorSource): VideoEditorProcessedResult {
    this.assertSourceOwnership(source);
    return this.session.buildResult();
  }

  cancel(source?: VideoEditorSource): void {
    this.session.clearDraft(source);
  }

  private hasMatchingDraft(source?: VideoEditorSource): boolean {
    const draft = this.session.peekDraft();
    if (!draft) {
      return false;
    }

    if (source && draft.source !== source) {
      throw new Error('A sessão ativa pertence a outra origem de edição.');
    }

    return true;
  }

  private assertSourceOwnership(source?: VideoEditorSource): void {
    const draft = this.session.peekDraft();
    if (source && draft && draft.source !== source) {
      throw new Error('A sessão ativa pertence a outra origem de edição.');
    }
  }

  private reportTechnicalError(
    error: unknown,
    source: VideoEditorSource
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error(String(error ?? 'Falha no editor de vídeo.'));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'VideoEditorLauncherService',
        op: 'launchVideoEditor',
        source,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Diagnóstico secundário não altera o fluxo de edição.
    }
  }
}
