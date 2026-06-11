// src/app/media/photos/photo-viewer/photo-viewer.component.ts
// Visualizador imersivo de fotos.
//
// Papel deste componente:
// - exibir a foto selecionada em modo imersivo;
// - permitir navegação anterior/próxima sem sair do modal;
// - carregar comentários públicos visíveis;
// - agrupar respostas abaixo do comentário pai;
// - permitir comentário quando a foto pública estiver aprovada e liberada;
// - permitir reação simples de curtir;
// - permitir resposta/moderação discreta pelo dono da foto;
// - manter links de autores abrindo em nova guia, sem fechar o viewer atual.
//
// Observação de manutenção:
// - Este componente não deve escrever diretamente no Firestore.
// - Comentários e moderação passam por MediaPhotoCommentsService.
// - Reações passam por MediaReactionsService.
// - Regras reais de permissão ficam no backend/rules; o template apenas melhora UX.

import { ChangeDetectionStrategy, Component, HostListener, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
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

* Opcional para futuras evoluções do painel lateral.
* Não é obrigatório para o mínimo funcional atual.
  */
  ownerNickname?: string | null;
  ownerPhotoURL?: string | null;

/**

* Campos usados quando o viewer recebe foto pública/projetada.
  */
  commentsEnabled?: boolean;
  commentsPolicy?: TPhotoCommentsPolicy;
  reactionsEnabled?: boolean;
  moderationStatus?: TPhotoModerationStatus;

/**

* Campos usados quando o viewer recebe item vindo da galeria privada.
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

type TCommentModerationAction = 'HIDE' | 'DELETE';

type TPhotoCommentThread = {
root: IPhotoComment;
replies: IPhotoComment[];
};

@Component({
selector: 'app-photo-viewer',
standalone: true,
imports: [CommonModule, RouterModule, MatDialogModule, ReactiveFormsModule],
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

readonly replyControl = new FormControl('', {
nonNullable: true,
validators: [Validators.required, Validators.maxLength(500)],
});

private readonly currentPhotoIdSubject = new BehaviorSubject<string>('');
readonly currentPhotoId$ = this.currentPhotoIdSubject.asObservable().pipe(
distinctUntilChanged()
);

private readonly submittingCommentSubject = new BehaviorSubject<boolean>(false);
readonly submittingComment$ = this.submittingCommentSubject.asObservable();

private readonly submittingReplySubject = new BehaviorSubject<boolean>(false);
readonly submittingReply$ = this.submittingReplySubject.asObservable();

private readonly togglingLikeSubject = new BehaviorSubject<boolean>(false);
readonly togglingLike$ = this.togglingLikeSubject.asObservable();

private readonly replyingToCommentIdSubject = new BehaviorSubject<string | null>(null);
readonly replyingToCommentId$ = this.replyingToCommentIdSubject.asObservable().pipe(
distinctUntilChanged()
);

private readonly moderatingCommentIdSubject = new BehaviorSubject<string | null>(null);
readonly moderatingCommentId$ = this.moderatingCommentIdSubject.asObservable().pipe(
distinctUntilChanged()
);

readonly viewerUser$ = this.currentUserStore.user$.pipe(
shareReplay({ bufferSize: 1, refCount: true })
);

readonly viewerUid$: Observable<string | null> = this.viewerUser$.pipe(
map((user) => (user as ViewerUserLike | null)?.uid ?? null),
distinctUntilChanged(),
shareReplay({ bufferSize: 1, refCount: true })
);

readonly viewerIsOwner$: Observable<boolean> = this.viewerUid$.pipe(
map((uid) => !!uid && uid === this.data.ownerUid),
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

readonly replyLength$: Observable<number> = this.replyControl.valueChanges.pipe(
startWith(this.replyControl.value),
map((value) => (value ?? '').trim().length),
distinctUntilChanged()
);

/**

* Lista bruta de comentários visíveis.
* A leitura não depende de currentCanComment$ porque uma foto pode ter
* comentários antigos visíveis mesmo se novos comentários forem bloqueados no futuro.
  */
  readonly comments$: Observable<IPhotoComment[]> = this.currentPhotoId$.pipe(
  switchMap((photoId) => {
  if (!photoId) {
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

/**

* Estrutura visual da conversa.
* Comentários raiz ficam como itens principais; respostas ficam aninhadas
* imediatamente abaixo do comentário original.
  */
  readonly commentThreads$: Observable<TPhotoCommentThread[]> = this.comments$.pipe(
  map((comments) => this.buildCommentThreads(comments)),
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

@HostListener('document:keydown.arrowleft', ['$event'])
onArrowLeft(event: Event): void {
  if (this.isTypingTarget(event.target)) {
    return;
  }

  event.preventDefault();
  this.prev();
}

@HostListener('document:keydown.arrowright', ['$event'])
onArrowRight(event: Event): void {
  if (this.isTypingTarget(event.target)) {
    return;
  }

  event.preventDefault();
  this.next();
}

close(): void {
this.dialogRef.close();
}

prev(): void {
if (!this.hasPrev) {
return;
}

this.index -= 1;
this.commentControl.setValue('');
this.cancelReply();
this.syncCurrentPhotoId();

}

next(): void {
if (!this.hasNext) {
return;
}


this.index += 1;
this.commentControl.setValue('');
this.cancelReply();
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
    catchError(() => {
      this.errorNotifier.showError('Erro ao atualizar reação.');
      return EMPTY;
    }),
    finalize(() => this.togglingLikeSubject.next(false))
  )
  .subscribe();


}

submitComment(event?: Event): void {
event?.preventDefault();
event?.stopPropagation();


const current = this.current;
const safeComment = (this.commentControl.value ?? '')
  .replace(/\s+/g, ' ')
  .trim();

this.debug('submitComment clicked', {
  hasCurrentPhoto: !!current?.id,
  photoId: current?.id ?? null,
  ownerUid: this.data.ownerUid,
  commentLength: safeComment.length,
});

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
    catchError(() => {
      this.errorNotifier.showError('Erro ao adicionar comentário.');
      return of(null);
    }),
    finalize(() => this.submittingCommentSubject.next(false))
  )
  .subscribe((commentId) => {
    this.debug('submitComment result', {
      hasCommentId: !!commentId,
      commentId,
    });

    if (!commentId) {
      return;
    }

    this.commentControl.setValue('');
    this.errorNotifier.showSuccess('Comentário adicionado.');
  });


}

startReply(comment: IPhotoComment): void {
if (!comment?.id) {
return;
}


if (comment.parentCommentId) {
  this.errorNotifier.showWarning('Respostas encadeadas não são permitidas.');
  return;
}

this.replyControl.setValue('');
this.replyingToCommentIdSubject.next(comment.id);
}

cancelReply(): void {
this.replyControl.setValue('');
this.replyingToCommentIdSubject.next(null);
}

submitReply(comment: IPhotoComment, event?: Event): void {
event?.preventDefault();
event?.stopPropagation();


const current = this.current;
const safeReply = (this.replyControl.value ?? '')
  .replace(/\s+/g, ' ')
  .trim();

if (!current?.id || !comment?.id) {
  this.errorNotifier.showWarning('Comentário inválido para resposta.');
  return;
}

if (!safeReply) {
  this.errorNotifier.showWarning('Digite uma resposta antes de enviar.');
  return;
}

if (safeReply.length > 500) {
  this.errorNotifier.showWarning('A resposta excede o limite de 500 caracteres.');
  return;
}

this.submittingReplySubject.next(true);

combineLatest([this.viewerIsOwner$, this.currentCanComment$])
  .pipe(
    take(1),
    switchMap(([viewerIsOwner, canComment]) => {
      if (!viewerIsOwner) {
        this.errorNotifier.showWarning('Somente o dono da foto pode responder como perfil.');
        return of(null);
      }

      if (!canComment) {
        this.errorNotifier.showWarning('Comentários indisponíveis nesta foto.');
        return of(null);
      }

      return this.mediaPhotoCommentsService.replyToComment$({
        ownerUid: this.data.ownerUid,
        photoId: current.id,
        parentCommentId: comment.id,
        content: safeReply,
      });
    }),
    catchError(() => {
      this.errorNotifier.showError('Erro ao adicionar resposta.');
      return of(null);
    }),
    finalize(() => this.submittingReplySubject.next(false))
  )
  .subscribe((replyId) => {
    if (!replyId) {
      return;
    }

    this.cancelReply();
    this.errorNotifier.showSuccess('Resposta adicionada.');
  });
}

hideComment(comment: IPhotoComment): void {
this.moderateComment(comment, 'HIDE');
}

deleteComment(comment: IPhotoComment): void {
this.moderateComment(comment, 'DELETE');
}

canShowReplyAction(comment: IPhotoComment, viewerIsOwner: boolean | null): boolean {
return !!viewerIsOwner && !!comment?.id && !comment.parentCommentId;
}

canShowHideAction(viewerIsOwner: boolean | null): boolean {
return !!viewerIsOwner;
}

canShowDeleteAction(
comment: IPhotoComment,
viewerUid: string | null,
viewerIsOwner: boolean | null
): boolean {
return !!comment?.id && (!!viewerIsOwner || (!!viewerUid && viewerUid === comment.authorUid));
}

isReplyingTo(
comment: IPhotoComment,
replyingToCommentId: string | null | undefined
): boolean {
return !!comment?.id && comment.id === replyingToCommentId;
}

private moderateComment(
comment: IPhotoComment,
action: TCommentModerationAction
): void {
const current = this.current;


if (!current?.id || !comment?.id) {
  this.errorNotifier.showWarning('Comentário inválido.');
  return;
}

this.moderatingCommentIdSubject.next(comment.id);

combineLatest([this.viewerUid$, this.viewerIsOwner$])
  .pipe(
    take(1),
    switchMap(([viewerUid, viewerIsOwner]) => {
      if (action === 'HIDE' && !viewerIsOwner) {
        this.errorNotifier.showWarning('Somente o dono da foto pode ocultar comentários.');
        return of(null);
      }

      if (
        action === 'DELETE' &&
        !viewerIsOwner &&
        (!viewerUid || viewerUid !== comment.authorUid)
      ) {
        this.errorNotifier.showWarning('Você não tem permissão para remover este comentário.');
        return of(null);
      }

      if (action === 'HIDE') {
        return this.mediaPhotoCommentsService.hideComment$(
          this.data.ownerUid,
          current.id,
          comment.id
        );
      }

      return this.mediaPhotoCommentsService.deleteComment$(
        this.data.ownerUid,
        current.id,
        comment.id
      );
    }),
    catchError(() => {
      this.errorNotifier.showError('Erro ao moderar comentário.');
      return of(null);
    }),
    finalize(() => this.moderatingCommentIdSubject.next(null))
  )
  .subscribe((status) => {
    if (!status) {
      return;
    }

    if (action === 'HIDE') {
      this.errorNotifier.showSuccess('Comentário ocultado.');
      return;
    }

    this.errorNotifier.showSuccess('Comentário removido.');
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

private buildCommentThreads(comments: IPhotoComment[]): TPhotoCommentThread[] {
const rootComments = comments.filter((comment) => !comment.parentCommentId);
const rootIds = new Set(
rootComments
.map((comment) => comment.id)
.filter((id): id is string => !!id)
);

const repliesByParentId = new Map<string, IPhotoComment[]>();

for (const comment of comments) {
  const parentCommentId = comment.parentCommentId;

  if (!parentCommentId || !rootIds.has(parentCommentId)) {
    continue;
  }

  const currentReplies = repliesByParentId.get(parentCommentId) ?? [];
  currentReplies.push(comment);
  repliesByParentId.set(parentCommentId, currentReplies);
}

return rootComments.map((root) => ({
  root,
  replies: root.id ? repliesByParentId.get(root.id) ?? [] : [],
}));

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

private isTypingTarget(target: EventTarget | null): boolean {
const element = target as HTMLElement | null;


if (!element) {
  return false;
}

const tagName = element.tagName.toLowerCase();

return (
  tagName === 'input' ||
  tagName === 'textarea' ||
  element.isContentEditable === true
);
}

private debug(message: string, extra?: unknown): void {
this.privacyDebug.log('media', `PhotoViewer: ${message}`, extra);
}
} // Line 800, end of file.
