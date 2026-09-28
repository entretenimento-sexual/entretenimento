import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MediaApplicationErrorService } from './media-application-error.service';
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly authSession = inject(AuthSessionService);
  private readonly session = inject(VideoEditorSessionService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private authenticatedUid: string | null = null;

  readonly draft$ = this.session.draft$;
  readonly state$ = this.session.state$;
  readonly posterBlob$ = this.session.posterBlob$;

  get lastTeardownReason() {
    return this.session.lastTeardownReason;
  }

  constructor() {
    this.authSession.uid$.pipe(
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((uid) => {
      const normalizedUid = String(uid ?? '').trim() || null;
      this.authenticatedUid = normalizedUid;
      this.session.clearIfOwnerMismatch(normalizedUid);
    });

    this.destroyRef.onDestroy(() => {
      this.authenticatedUid = null;
      this.session.clearDraft(undefined, 'destroyed');
    });
  }

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
            this.session.clearIfOwnerMismatch(null);
            return throwError(() => new Error(
              'Usuário não autenticado para abrir o editor de vídeo.'
            ));
          }

          this.authenticatedUid = ownerUid;
          this.session.setDraft(
            file,
            ownerUid,
            source,
            options.context
          );

          const draft = this.session.peekDraft(ownerUid);
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
    const ownerUid = this.currentOwnerUid();
    if (!ownerUid || !this.hasMatchingDraft(ownerUid, source)) {
      return;
    }

    this.session.updateState(state, ownerUid);
  }

  updatePoster(blob: Blob | null, source?: VideoEditorSource): void {
    const ownerUid = this.currentOwnerUid();
    if (!ownerUid || !this.hasMatchingDraft(ownerUid, source)) {
      return;
    }

    this.session.updatePoster(blob, ownerUid);
  }

  complete(source?: VideoEditorSource): VideoEditorProcessedResult {
    const ownerUid = this.requireAuthenticatedOwnerUid();
    this.assertSourceOwnership(ownerUid, source);
    return this.session.takeResult(ownerUid, source);
  }

  cancel(source?: VideoEditorSource): void {
    this.session.clearDraft(source, 'cancelled');
  }

  private currentOwnerUid(): string | null {
    if (this.authSession.isTerminatingSnapshot) {
      this.authenticatedUid = null;
      this.session.clearIfOwnerMismatch(null);
      return null;
    }

    return this.authenticatedUid;
  }

  private requireAuthenticatedOwnerUid(): string {
    const ownerUid = this.currentOwnerUid();
    if (!ownerUid) {
      throw new Error(
        'Sua sessão de usuário mudou. Selecione o vídeo novamente para continuar.'
      );
    }

    return ownerUid;
  }

  private hasMatchingDraft(
    ownerUid: string,
    source?: VideoEditorSource
  ): boolean {
    const draft = this.session.peekDraft(ownerUid);
    if (!draft) {
      return false;
    }

    if (source && draft.source !== source) {
      throw new Error('A sessão ativa pertence a outra origem de edição.');
    }

    return true;
  }

  private assertSourceOwnership(
    ownerUid: string,
    source?: VideoEditorSource
  ): void {
    const draft = this.session.peekDraft(ownerUid);

    if (!draft) {
      return;
    }

    if (source && draft.source !== source) {
      throw new Error('A sessão ativa pertence a outra origem de edição.');
    }
  }

  private reportTechnicalError(
    error: unknown,
    source: VideoEditorSource
  ): void {
    this.mediaError.report(error, {
      operation: 'launchVideoEditor',
      reasonHint: 'video_editor_open_failed',
      metadata: {
        scope: 'VideoEditorLauncherService',
        source,
      },
    });
  }
}
