// src/app/media/photos/photo-viewer/photo-viewer.component.ts
// Viewer modal com comentários e reações reais.
//
// AJUSTES DESTA VERSÃO:
// - mantém navegação anterior/próxima
// - mantém comentários reais
// - adiciona curtida real com contagem reativa
// - mantém acessibilidade básica e foco natural

import { ChangeDetectionStrategy, Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';

import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, shareReplay, startWith, switchMap, take } from 'rxjs/operators';

import { MediaCommentsService } from 'src/app/core/services/media/media-comments.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { PhotoComment } from 'src/app/core/services/image-handling/photo-firestore.service';

export interface IProfilePhotoItem {
  id: string;
  url: string;
  alt?: string;
  createdAt?: number;
  path?: string;
  fileName?: string;
  ownerUid?: string;
}

export interface IPhotoViewerData {
  ownerUid: string;
  items: IProfilePhotoItem[];
  startIndex: number;
}

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

  private readonly DEBUG = true;

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

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((user) => user?.uid ?? null),
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
          this.mediaReactionsService.isPhotoLikedByViewer$(this.data.ownerUid, photoId, viewerUid)
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

  readonly comments$: Observable<PhotoComment[]> = this.currentPhotoId$.pipe(
    switchMap((photoId) => {
      if (!photoId) {
        return of([] as PhotoComment[]);
      }

      return this.mediaCommentsService.getPhotoComments$(this.data.ownerUid, photoId);
    }),
    catchError(() => {
      this.errorNotifier.showError('Erro ao carregar os comentários.');
      return of([] as PhotoComment[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly dialogRef: MatDialogRef<PhotoViewerComponent>,
    private readonly mediaCommentsService: MediaCommentsService,
    private readonly mediaReactionsService: MediaReactionsService,
    private readonly errorNotifier: ErrorNotificationService,
    @Inject(MAT_DIALOG_DATA) public readonly data: IPhotoViewerData
  ) {
    this.index = Math.max(0, Math.min(data.startIndex ?? 0, (data.items?.length ?? 1) - 1));
    this.syncCurrentPhotoId();

    if (this.DEBUG) {
      // eslint-disable-next-line no-console
      console.debug('[PhotoViewer] init', {
        index: this.index,
        count: data.items?.length,
      });
    }
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
    this.syncCurrentPhotoId();
  }

  next(): void {
    if (!this.hasNext) return;
    this.index += 1;
    this.syncCurrentPhotoId();
  }

  toggleLike(): void {
    const current = this.current;

    if (!current?.id) {
      this.errorNotifier.showWarning('Nenhuma foto ativa para reagir.');
      return;
    }

    this.togglingLikeSubject.next(true);

    this.viewerUid$
      .pipe(
        take(1),
        switchMap((viewerUid) =>
          this.mediaReactionsService.toggleLikePhoto$(this.data.ownerUid, current.id, viewerUid)
        ),
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

    this.mediaCommentsService
      .addPhotoComment$(this.data.ownerUid, current.id, safeComment)
      .pipe(
        take(1),
        finalize(() => this.submittingCommentSubject.next(false))
      )
      .subscribe({
        next: () => {
          this.commentControl.setValue('');
          this.errorNotifier.showSuccess('Comentário adicionado.');
        },
        error: () => {
          // o fluxo inferior já notifica erro
        },
      });
  }

  private syncCurrentPhotoId(): void {
    this.currentPhotoIdSubject.next(this.current?.id ?? '');
  }
}