import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map } from 'rxjs';

import {
  EMPTY_VIDEO_EDITOR_STATE,
  IVideoEditorState,
  VideoEditorContext,
  VideoEditorProcessedResult,
} from './video-editor-result.model';

export type VideoEditorSource =
  | 'profile-videos'
  | 'social-feed'
  | 'community-feed'
  | 'generic';

export interface IVideoEditorDraft {
  readonly source: VideoEditorSource;
  readonly context: VideoEditorContext;
  readonly ownerUid: string;
  readonly file: File;
  readonly state: IVideoEditorState;
  readonly posterBlob: Blob | null;
  readonly createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class VideoEditorSessionService {
  private readonly draftSubject = new BehaviorSubject<IVideoEditorDraft | null>(null);

  readonly draft$: Observable<IVideoEditorDraft | null> =
    this.draftSubject.asObservable();

  readonly state$: Observable<IVideoEditorState | null> = this.draft$.pipe(
    map((draft) => draft?.state ?? null),
    distinctUntilChanged()
  );

  readonly posterBlob$: Observable<Blob | null> = this.draft$.pipe(
    map((draft) => draft?.posterBlob ?? null),
    distinctUntilChanged()
  );

  setDraft(
    file: File,
    ownerUid: string,
    source: VideoEditorSource = 'generic',
    context: VideoEditorContext = this.resolveSourceContext(source)
  ): void {
    const normalizedOwnerUid = String(ownerUid ?? '').trim();
    if (!normalizedOwnerUid) {
      throw new Error('O editor de vídeo requer um proprietário autenticado.');
    }

    this.draftSubject.next({
      source,
      context,
      ownerUid: normalizedOwnerUid,
      file,
      state: EMPTY_VIDEO_EDITOR_STATE,
      posterBlob: null,
      createdAt: Date.now(),
    });
  }

  updateState(state: IVideoEditorState): void {
    const draft = this.requireDraft();
    this.draftSubject.next({ ...draft, state });
  }

  updatePoster(blob: Blob | null): void {
    const draft = this.requireDraft();
    this.draftSubject.next({ ...draft, posterBlob: blob });
  }

  peekDraft(): IVideoEditorDraft | null {
    return this.draftSubject.value;
  }

  buildResult(): VideoEditorProcessedResult {
    const draft = this.requireDraft();
    if (!draft.state.valid) {
      throw new Error(
        draft.state.loading
          ? 'Aguarde a leitura do vídeo antes de continuar.'
          : draft.state.error || 'Revise a edição antes de continuar.'
      );
    }

    return {
      kind: 'video',
      file: draft.file,
      recipe: draft.state.recipe,
      posterBlob: draft.posterBlob,
      context: draft.context,
    };
  }

  clearDraft(source?: VideoEditorSource): void {
    const draft = this.draftSubject.value;
    if (source && draft?.source !== source) {
      return;
    }

    this.draftSubject.next(null);
  }

  private requireDraft(): IVideoEditorDraft {
    const draft = this.draftSubject.value;
    if (!draft) {
      throw new Error('Nenhuma sessão de edição de vídeo está ativa.');
    }
    return draft;
  }

  private resolveSourceContext(source: VideoEditorSource): VideoEditorContext {
    switch (source) {
      case 'profile-videos':
        return 'profile-video';
      case 'social-feed':
        return 'social-feed';
      case 'community-feed':
        return 'community-feed';
      default:
        return 'generic';
    }
  }
}
