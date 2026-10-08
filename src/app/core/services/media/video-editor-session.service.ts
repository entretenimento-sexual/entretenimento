import { Injectable, Optional } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
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

export type VideoEditorSessionTeardownReason =
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'auth-changed'
  | 'replaced'
  | 'destroyed';

export const VIDEO_EDITOR_DRAFT_IDLE_TTL_MS = 15 * 60 * 1000;

export interface IVideoEditorDraft {
  readonly source: VideoEditorSource;
  readonly context: VideoEditorContext;
  readonly ownerUid: string;
  readonly file: File;
  readonly state: IVideoEditorState;
  readonly posterBlob: Blob | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class VideoEditorSessionService {
  private readonly draftSubject =
    new BehaviorSubject<IVideoEditorDraft | null>(null);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTeardownReasonValue: VideoEditorSessionTeardownReason | null = null;
  private activeOwnerUid: string | null = null;

  constructor(@Optional() private readonly authSession: AuthSessionService | null = null) {
    this.authSession?.uid$.pipe(takeUntilDestroyed()).subscribe((uid) => {
      this.activeOwnerUid = String(uid ?? '').trim() || null;
      this.clearIfOwnerMismatch(this.activeOwnerUid);
    });
  }

  private assertActiveOwner(ownerUid: string): void {
    if (
      this.authSession &&
      (this.authSession.isTerminatingSnapshot || this.activeOwnerUid !== ownerUid)
    ) {
      this.clearDraft(undefined, 'auth-changed');
      throw new Error('Sua sessão de usuário mudou. Selecione o vídeo novamente para continuar.');
    }
  }

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

  get lastTeardownReason(): VideoEditorSessionTeardownReason | null {
    return this.lastTeardownReasonValue;
  }

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
    this.assertActiveOwner(normalizedOwnerUid);

    this.clearDraft(undefined, 'replaced');

    const createdAt = Date.now();
    const expiresAt = createdAt + VIDEO_EDITOR_DRAFT_IDLE_TTL_MS;

    this.lastTeardownReasonValue = null;
    this.draftSubject.next({
      source,
      context,
      ownerUid: normalizedOwnerUid,
      file,
      state: EMPTY_VIDEO_EDITOR_STATE,
      posterBlob: null,
      createdAt,
      expiresAt,
    });
    this.scheduleExpiry(expiresAt);
  }

  updateState(state: IVideoEditorState, ownerUid: string): void {
    const draft = this.requireOwnedDraft(ownerUid);
    this.publishTouchedDraft({ ...draft, state });
  }

  updatePoster(blob: Blob | null, ownerUid: string): void {
    const draft = this.requireOwnedDraft(ownerUid);
    this.publishTouchedDraft({ ...draft, posterBlob: blob });
  }

  peekDraft(ownerUid?: string | null): IVideoEditorDraft | null {
    const draft = this.currentLiveDraft();
    if (!draft) {
      return null;
    }

    if (ownerUid !== undefined) {
      const normalizedOwnerUid = String(ownerUid ?? '').trim();
      if (!normalizedOwnerUid || draft.ownerUid !== normalizedOwnerUid) {
        this.clearDraft(undefined, 'auth-changed');
        return null;
      }
    }

    return draft;
  }

  takeResult(
    ownerUid: string,
    source?: VideoEditorSource
  ): VideoEditorProcessedResult {
    const draft = this.requireOwnedDraft(ownerUid);

    if (source && draft.source !== source) {
      throw new Error('A sessão ativa pertence a outra origem de edição.');
    }

    if (!draft.state.valid) {
      throw new Error(
        draft.state.loading
          ? 'Aguarde a leitura do vídeo antes de continuar.'
          : draft.state.error || 'Revise a edição antes de continuar.'
      );
    }

    const result: VideoEditorProcessedResult = {
      kind: 'video',
      file: draft.file,
      recipe: draft.state.recipe,
      posterBlob: draft.posterBlob,
      context: draft.context,
    };

    this.clearDraft(source, 'completed');
    return result;
  }

  buildResult(ownerUid?: string): VideoEditorProcessedResult {
    const draft = ownerUid === undefined
      ? this.requireDraft()
      : this.requireOwnedDraft(ownerUid);

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

  clearIfOwnerMismatch(ownerUid: string | null): boolean {
    const draft = this.currentLiveDraft();
    if (!draft) {
      return false;
    }

    const normalizedOwnerUid = String(ownerUid ?? '').trim();
    if (normalizedOwnerUid && draft.ownerUid === normalizedOwnerUid) {
      return false;
    }

    this.clearDraft(undefined, 'auth-changed');
    return true;
  }

  clearDraft(
    source?: VideoEditorSource,
    reason: VideoEditorSessionTeardownReason = 'cancelled'
  ): void {
    const draft = this.draftSubject.value;
    if (source && draft?.source !== source) {
      return;
    }

    this.cancelExpiryTimer();

    if (draft) {
      this.lastTeardownReasonValue = reason;
      // Remover o draft do BehaviorSubject elimina as referências fortes
      // mantidas pelo editor ao File e ao poster Blob. O chamador que recebeu
      // um resultado concluído passa a ser o único responsável por essas refs.
      this.draftSubject.next(null);
    }
  }

  private requireDraft(): IVideoEditorDraft {
    const draft = this.currentLiveDraft();
    if (!draft) {
      if (this.lastTeardownReasonValue === 'expired') {
        throw new Error(
          'A sessão do editor de vídeo expirou por inatividade. Selecione o vídeo novamente.'
        );
      }

      if (this.lastTeardownReasonValue === 'auth-changed') {
        throw new Error(
          'Sua sessão de usuário mudou. Selecione o vídeo novamente para continuar.'
        );
      }

      throw new Error('Nenhuma sessão de edição de vídeo está ativa.');
    }
    return draft;
  }

  private requireOwnedDraft(ownerUid: string): IVideoEditorDraft {
    const normalizedOwnerUid = String(ownerUid ?? '').trim();
    this.assertActiveOwner(normalizedOwnerUid);
    const draft = this.requireDraft();

    if (!normalizedOwnerUid || draft.ownerUid !== normalizedOwnerUid) {
      this.clearDraft(undefined, 'auth-changed');
      throw new Error(
        'Sua sessão de usuário mudou. Selecione o vídeo novamente para continuar.'
      );
    }

    return draft;
  }

  private currentLiveDraft(): IVideoEditorDraft | null {
    const draft = this.draftSubject.value;
    if (!draft) {
      return null;
    }

    if (
      this.authSession &&
      (this.authSession.isTerminatingSnapshot || draft.ownerUid !== this.activeOwnerUid)
    ) {
      this.clearDraft(undefined, 'auth-changed');
      return null;
    }

    if (Date.now() >= draft.expiresAt) {
      this.clearDraft(undefined, 'expired');
      return null;
    }

    return draft;
  }

  private publishTouchedDraft(draft: IVideoEditorDraft): void {
    const expiresAt = Date.now() + VIDEO_EDITOR_DRAFT_IDLE_TTL_MS;
    this.draftSubject.next({
      ...draft,
      expiresAt,
    });
    this.scheduleExpiry(expiresAt);
  }

  private scheduleExpiry(expiresAt: number): void {
    this.cancelExpiryTimer();

    const delayMs = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      const draft = this.draftSubject.value;
      if (!draft || draft.expiresAt !== expiresAt) {
        return;
      }

      if (Date.now() >= draft.expiresAt) {
        this.clearDraft(undefined, 'expired');
      }
    }, delayMs);

    // Em Node/Vitest, um TTL longo não deve manter o processo vivo.
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.expiryTimer = timer;
  }

  private cancelExpiryTimer(): void {
    if (this.expiryTimer === null) {
      return;
    }

    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
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
