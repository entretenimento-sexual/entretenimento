// src/app/media/photos/photo-viewer/photo-viewer.component.ts
// Viewer modal de fotos.
//
// Objetivos desta versão:
// - manter navegação anterior/próxima;
// - trocar comentários antigos pela nova camada pública MediaPhotoCommentsService;
// - só permitir comentário quando a foto estiver APPROVED + commentsEnabled;
// - manter reações existentes, mas já respeitando reactionsEnabled/moderação;
// - remover console.debug direto;
// - usar PrivacyDebugLoggerService;
// - preservar acessibilidade básica e fluxo reativo.

import { ChangeDetectionStrategy, Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { MediaPhotoCommentsService } from 'src/app/core/services/media/media-photo-comments.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';

import { IPhotoComment } from 'src/app/core/interfaces/media/i-photo-comment';
import {
  IPhotoPublicationConfig,
  TPhotoCommentsPolicy,
  TPhotoModerationStatus,
} from 'src/app/core/interfaces/media/i-photo-publication-config';

export interface IProfilePhotoItem {
  id: string;
  url: string;
  alt?: string;
  createdAt?: number;
  path?: string;
  fileName?: string;
  ownerUid?: string;

  /**
   * Campos opcionais usados quando o viewer recebe foto pública/projetada.
   */
  commentsEnabled?: boolean;
  commentsPolicy?: TPhotoCommentsPolicy;
  reactionsEnabled?: boolean;
  moderationStatus?: TPhotoModerationStatus;

  /**
   * Campos usados quando o viewer recebe card da galeria privada.
   */
  publication?: IPhotoPublicationConfig;
}

export interface IPhotoViewerData {
  ownerUid: string;
  items: IProfilePhotoItem[];
  startIndex: number;
}

type ViewerUserLike = {
  uid?: string | null;
  nickname?: string | null;
  displayName?: string | null;
  nome?: string | null;
  name?: string | null;
};

type PhotoInteractionState = {
  commentsEnabled: boolean;
  commentsPolicy: TPhotoCommentsPolicy;
  reactionsEnabled: boolean;
  moderationStatus: TPhotoModerationStatus;
};

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, MatDialogModule, ReactiveFormsModule],
  templateUrl: './photo-viewer.component.html',
  styleUrls: ['./photo-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewerComponent {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  index: number;

  readonly commentControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });

  private readonly currentPhotoIdSubject = new BehaviorSubject<string>('');
  readonly currentPhotoId$ = this.currentPhotoIdSubject.asObservable().pipe(
    distinctUntilChanged()
  );

  private readonly submittingCommentSubject = new BehaviorSubject<boolean>(false);
  readonly submittingComment$ = this.submittingCommentSubject.asObservable();

  private readonly togglingLikeSubject = new BehaviorSubject<boolean>(false);
  readonly togglingLike$ = this.togglingLikeSubject.asObservable();

  readonly viewerUser$ = this.currentUserStore.user$.pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerUid$: Observable<string | null> = this.viewerUser$.pipe(
    map((user) => (user as ViewerUserLike | null)?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerNickname$: Observable<string> = this.viewerUser$.pipe(
    map((user) => this.resolveViewerNickname(user)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentPhoto$: Observable<IProfilePhotoItem | null> = this.currentPhotoId$.pipe(
    map(() => this.current),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentCanComment$: Observable<boolean> = this.currentPhoto$.pipe(
    map((photo) => this.canCommentOnPhoto(photo)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentCanReact$: Observable<boolean> = this.currentPhoto$.pipe(
    map((photo) => this.canReactToPhoto(photo)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly commentDisabledReason$: Observable<string> = this.currentPhoto$.pipe(
    map((photo) => this.getCommentDisabledReason(photo)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly likesCount$: Observable<number> = this.currentPhotoId$.pipe(
    switchMap((photoId) => {
      if (!photoId) {
        return of(0);
      }

      return this.mediaReactionsService.getPhotoLikesCount$(this.data.ownerUid, photoId);
    }),
    catchError(() => of(0)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly likedByViewer$: Observable<boolean> = this.currentPhotoId$.pipe(
    switchMap((photoId) => {
      if (!photoId) {
        return of(false);
      }

      return this.viewerUid$.pipe(
        switchMap((viewerUid) =>
          this.mediaReactionsService.isPhotoLikedByViewer$(
            this.data.ownerUid,
            photoId,
            viewerUid
          )
        )
      );
    }),
    catchError(() => of(false)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly commentLength$: Observable<number> = this.commentControl.valueChanges.pipe(
    startWith(this.commentControl.value),
    map((value) => (value ?? '').trim().length),
    distinctUntilChanged()
  );

  readonly comments$: Observable<IPhotoComment[]> = combineLatest([
    this.currentPhotoId$,
    this.currentCanComment$,
  ]).pipe(
    switchMap(([photoId, canComment]) => {
      if (!photoId || !canComment) {
        return of([] as IPhotoComment[]);
      }

      return this.mediaPhotoCommentsService.watchVisibleComments$(
        this.data.ownerUid,
        photoId
      );
    }),
    catchError(() => {
      this.errorNotifier.showError('Erro ao carregar os comentários.');
      return of([] as IPhotoComment[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly dialogRef: MatDialogRef<PhotoViewerComponent>,
    private readonly mediaPhotoCommentsService: MediaPhotoCommentsService,
    private readonly mediaReactionsService: MediaReactionsService,
    private readonly errorNotifier: ErrorNotificationService,
    @Inject(MAT_DIALOG_DATA) public readonly data: IPhotoViewerData
  ) {
    this.index = Math.max(
      0,
      Math.min(data.startIndex ?? 0, (data.items?.length ?? 1) - 1)
    );

    this.syncCurrentPhotoId();

    this.debug('init', {
      index: this.index,
      count: data.items?.length ?? 0,
      hasOwnerUid: !!data.ownerUid,
    });
  }

  get current(): IProfilePhotoItem | null {
    return this.data.items?.[this.index] ?? null;
  }

  get hasPrev(): boolean {
    return this.index > 0;
  }

  get hasNext(): boolean {
    return this.index < (this.data.items?.length ?? 0) - 1;
  }

  close(): void {
    this.dialogRef.close();
  }

  prev(): void {
    if (!this.hasPrev) return;

    this.index -= 1;
    this.commentControl.setValue('');
    this.syncCurrentPhotoId();
  }

  next(): void {
    if (!this.hasNext) return;

    this.index += 1;
    this.commentControl.setValue('');
    this.syncCurrentPhotoId();
  }

  toggleLike(): void {
    const current = this.current;

    if (!current?.id) {
      this.errorNotifier.showWarning('Nenhuma foto ativa para reagir.');
      return;
    }

    this.togglingLikeSubject.next(true);

    combineLatest([this.viewerUid$, this.currentCanReact$])
      .pipe(
        take(1),
        switchMap(([viewerUid, canReact]) => {
          if (!viewerUid) {
            this.errorNotifier.showWarning('Entre na sua conta para curtir.');
            return EMPTY;
          }

          if (!canReact) {
            this.errorNotifier.showWarning('Reações indisponíveis nesta foto.');
            return EMPTY;
          }

          return this.mediaReactionsService.toggleLikePhoto$(
            this.data.ownerUid,
            current.id,
            viewerUid
          );
        }),
        finalize(() => this.togglingLikeSubject.next(false))
      )
      .subscribe();
  }

  submitComment(): void {
    const current = this.current;
    const safeComment = (this.commentControl.value ?? '').replace(/\s+/g, ' ').trim();

    if (!current?.id) {
      this.errorNotifier.showWarning('Nenhuma foto ativa para comentar.');
      return;
    }

    if (!safeComment) {
      this.errorNotifier.showWarning('Digite um comentário antes de enviar.');
      return;
    }

    if (safeComment.length > 500) {
      this.errorNotifier.showWarning('O comentário excede o limite de 500 caracteres.');
      return;
    }

    this.submittingCommentSubject.next(true);

    combineLatest([
      this.viewerUid$,
      this.viewerNickname$,
      this.currentCanComment$,
    ])
      .pipe(
        take(1),
        switchMap(([viewerUid, viewerNickname, canComment]) => {
          if (!viewerUid) {
            this.errorNotifier.showWarning('Entre na sua conta para comentar.');
            return of(null);
          }

          if (!canComment) {
            this.errorNotifier.showWarning('Comentários indisponíveis nesta foto.');
            return of(null);
          }

          return this.mediaPhotoCommentsService.createComment$({
            ownerUid: this.data.ownerUid,
            photoId: current.id,
            authorUid: viewerUid,
            authorNickname: viewerNickname,
            content: safeComment,
          });
        }),
        finalize(() => this.submittingCommentSubject.next(false))
      )
      .subscribe((commentId) => {
        if (!commentId) {
          return;
        }

        this.commentControl.setValue('');
        this.errorNotifier.showSuccess('Comentário adicionado.');
      });
  }

  private syncCurrentPhotoId(): void {
    this.currentPhotoIdSubject.next(this.current?.id ?? '');
  }

  private getPhotoInteractionState(photo: IProfilePhotoItem | null): PhotoInteractionState {
    const publication = photo?.publication;

    return {
      commentsEnabled: photo?.commentsEnabled ?? publication?.commentsEnabled ?? false,
      commentsPolicy: photo?.commentsPolicy ?? publication?.commentsPolicy ?? 'OFF',
      reactionsEnabled: photo?.reactionsEnabled ?? publication?.reactionsEnabled ?? false,
      moderationStatus:
        photo?.moderationStatus ?? publication?.moderationStatus ?? 'PRIVATE',
    };
  }

  private canCommentOnPhoto(photo: IProfilePhotoItem | null): boolean {
    const state = this.getPhotoInteractionState(photo);

    return (
      state.moderationStatus === 'APPROVED' &&
      state.commentsEnabled === true &&
      state.commentsPolicy === 'EVERYONE'
    );
  }

  private canReactToPhoto(photo: IProfilePhotoItem | null): boolean {
    const state = this.getPhotoInteractionState(photo);

    return (
      state.moderationStatus === 'APPROVED' &&
      state.reactionsEnabled === true
    );
  }

  private getCommentDisabledReason(photo: IProfilePhotoItem | null): string {
    if (!photo) {
      return 'Nenhuma foto ativa.';
    }

    const state = this.getPhotoInteractionState(photo);

    if (state.moderationStatus !== 'APPROVED') {
      return 'Comentários disponíveis apenas após aprovação da foto.';
    }

    if (!state.commentsEnabled) {
      return 'Comentários desativados nesta foto.';
    }

    if (state.commentsPolicy !== 'EVERYONE') {
      return 'Comentários restritos pela configuração da foto.';
    }

    return '';
  }

  private resolveViewerNickname(user: unknown): string {
    const currentUser = user as ViewerUserLike | null;

    const nickname =
      currentUser?.nickname ??
      currentUser?.displayName ??
      currentUser?.nome ??
      currentUser?.name ??
      'Usuário';

    const safeNickname = String(nickname ?? '').trim();

    return safeNickname ? safeNickname.slice(0, 40) : 'Usuário';
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('media', `PhotoViewer: ${message}`, extra);
  }
}