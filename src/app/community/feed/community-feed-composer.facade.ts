// src/app/community/feed/community-feed-composer.facade.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED COMPOSER FACADE
// -----------------------------------------------------------------------------
// Responsabilidade canônica do composer do Mural: rascunho, anexo, captura de
// localização, upload, idempotência e publicação. A facade deve ser provida no
// componente para que cada instância mantenha estado próprio e descartável.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, Injector, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defaultIfEmpty,
  exhaustMap,
  filter,
  finalize,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeLast,
  takeUntil,
  takeWhile,
  tap,
  throwError,
  timer,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  GeolocationError,
  GeolocationErrorCode,
  GeolocationService,
} from 'src/app/core/services/geolocation/geolocation.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import {
  CommunityFeedPostCreateRequest,
  CommunityFeedPostCreateResponse,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import {
  COMMUNITY_FEED_POST_CODE_MESSAGES,
  COMMUNITY_FEED_POST_REASON_MESSAGES,
} from '../presentation/community-error.messages';
import {
  CommunityComposerAttachment,
  createCommunityComposerLocationAttachment,
  validateCommunityComposerImage,
} from './community-composer-attachment.model';
import { createCommunityFeedRequestId } from './community-feed-request-id';

export interface CommunityFeedComposerContext {
  readonly communityId: string;
  readonly view: CommunityFeedView;
  readonly sourceType: CommunityPreviewSourceType;
  readonly canInteract: boolean;
}

export type CommunityFeedPostWriteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' };

interface CommunityFeedComposerCommand {
  readonly request: CommunityFeedPostCreateRequest;
  readonly attachment: CommunityComposerAttachment | null;
  readonly context: CommunityFeedComposerContext;
}

const COMMUNITY_LOCATION_CAPTURE_WINDOW_MS = 8_000;
const COMMUNITY_LOCATION_TARGET_ACCURACY_METERS = 30;
const COMMUNITY_LOCATION_LOW_ACCURACY_WARNING_METERS = 250;
const COMMUNITY_UPLOAD_SESSION_ERROR_CODE = 'community/session-required';

@Injectable()
export class CommunityFeedComposerFacade implements OnDestroy {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly geolocation = inject(GeolocationService);
  private readonly postCreateRequests$ = new Subject<CommunityFeedComposerCommand>();
  private readonly postCreatedSubject = new Subject<CommunityFeedPostCreateResponse>();
  private pendingPostRequestId: string | null = null;

  readonly composerExpanded = signal(false);
  readonly selectedAttachment = signal<CommunityComposerAttachment | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  readonly locationCaptureState = signal<'idle' | 'loading'>('idle');
  readonly postCreated$ = this.postCreatedSubject.asObservable();

  readonly postForm = new FormGroup({
    text: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1_000)],
    }),
  });

  readonly postCreateState$ = this.postCreateRequests$.pipe(
    exhaustMap((command) =>
      this.createMessage$(command).pipe(
        tap((result) => {
          this.pendingPostRequestId = null;
          this.postForm.reset({ text: '' });
          this.clearSelectedAttachment();
          this.composerExpanded.set(false);
          this.postCreatedSubject.next(result);
          this.showPostSuccess(result.deduplicated);
        }),
        map((): CommunityFeedPostWriteState => ({ status: 'idle' })),
        startWith<CommunityFeedPostWriteState>({ status: 'loading' }),
        catchError(() => {
          // Falha de envio é um motivo real para revelar o feedback inline;
          // foco/entrada de texto, isoladamente, não devem alterar a geometria.
          this.composerExpanded.set(true);
          return of<CommunityFeedPostWriteState>({ status: 'error' });
        })
      )
    ),
    startWith<CommunityFeedPostWriteState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnDestroy(): void {
    this.revokePreviewUrl(this.selectedImagePreviewUrl());
    this.postCreatedSubject.complete();
    this.postCreateRequests$.complete();
  }

  canCreatePost(context: CommunityFeedComposerContext): boolean {
    return context.view === 'feed'
      && context.sourceType === 'community'
      && context.canInteract;
  }

  expandComposer(context: CommunityFeedComposerContext): void {
    // O binding de foco é preservado por compatibilidade, mas a expansão visual
    // só ocorre quando existe conteúdo estrutural que realmente precisa de espaço.
    if (this.canCreatePost(context) && this.selectedAttachment()) {
      this.composerExpanded.set(true);
    }
  }

  cancelPost(): void {
    this.pendingPostRequestId = null;
    this.postForm.reset({ text: '' });
    this.clearSelectedAttachment();
    this.uploadProgress.set(null);
    this.composerExpanded.set(false);
  }

  onPhotoSelected(event: Event, context: CommunityFeedComposerContext): void {
    if (!this.canCreatePost(context)) return;

    const inputElement = event.target as HTMLInputElement | null;
    const file = inputElement?.files?.[0] ?? null;
    if (inputElement) inputElement.value = '';
    if (!file) return;

    const validation = validateCommunityComposerImage(file);
    if (!validation.valid) {
      this.errorNotifier.showWarning(validation.userMessage);
      return;
    }

    this.clearSelectedAttachment();
    this.selectedAttachment.set({
      kind: 'image',
      file,
      previewUrl: this.createPreviewUrl(file),
    });
    this.composerExpanded.set(true);
  }

  removeSelectedPhoto(): void {
    this.clearSelectedAttachment();
    this.composerExpanded.set(false);
  }

  shareApproximateLocation(context: CommunityFeedComposerContext): void {
    if (
      !this.canCreatePost(context)
      || this.locationCaptureState() === 'loading'
    ) {
      return;
    }

    this.locationCaptureState.set('loading');

    this.geolocation.watchPosition$({
      enableHighAccuracy: true,
      timeout: COMMUNITY_LOCATION_CAPTURE_WINDOW_MS,
      maximumAge: 0,
    }).pipe(
      scan((best, current) =>
        current.accuracy < best.accuracy ? current : best
      ),
      takeWhile(
        (coordinates) =>
          coordinates.accuracy > COMMUNITY_LOCATION_TARGET_ACCURACY_METERS,
        true
      ),
      takeUntil(timer(COMMUNITY_LOCATION_CAPTURE_WINDOW_MS)),
      takeLast(1),
      defaultIfEmpty(null),
      map((coordinates) => {
        if (!coordinates) {
          throw new Error('Nenhuma coordenada disponível durante a captura.');
        }
        return createCommunityComposerLocationAttachment(
          coordinates.latitude,
          coordinates.longitude,
          coordinates.accuracy
        );
      }),
      tap((attachment) => {
        if (!attachment) {
          throw new Error('Coordenadas inválidas para compartilhamento no Mural.');
        }

        this.clearSelectedAttachment();
        this.selectedAttachment.set(attachment);
        this.composerExpanded.set(true);

        const accuracy = attachment.accuracyMeters;
        if (
          accuracy !== null
          && accuracy > COMMUNITY_LOCATION_LOW_ACCURACY_WARNING_METERS
        ) {
          this.errorNotifier.showWarning(
            `Localização adicionada, mas o dispositivo informou baixa precisão (${this.locationAccuracyLabel(accuracy)}).`
          );
        } else {
          this.errorNotifier.showSuccess(
            `Localização atual adicionada. ${this.locationAccuracyLabel(accuracy)}.`
          );
        }
      }),
      catchError((error: unknown) => {
        this.reportLocationError(error, context);
        return EMPTY;
      }),
      finalize(() => this.locationCaptureState.set('idle')),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  approximateLocationLabel(latitude: number, longitude: number): string {
    const formatCoordinate = (value: number) =>
      Number(value.toFixed(6)).toString();
    return `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;
  }

  locationAccuracyLabel(accuracyMeters: number | null | undefined): string {
    const parsed = Number(accuracyMeters);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 'Precisão não informada pelo dispositivo';
    }

    const roundedMeters = Math.max(0, Math.round(parsed));
    if (roundedMeters < 1_000) {
      return `Precisão estimada: ±${roundedMeters} m`;
    }

    const kilometers = Number((roundedMeters / 1_000).toFixed(1))
      .toString()
      .replace('.', ',');
    return `Precisão estimada: ±${kilometers} km`;
  }

  submitPostOnEnter(event: Event, context: CommunityFeedComposerContext): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.isComposing || keyboardEvent.shiftKey) {
      return;
    }

    event.preventDefault();
    if (keyboardEvent.repeat) {
      return;
    }

    this.submitPost(context);
  }

  submitPost(context: CommunityFeedComposerContext): void {
    if (!this.canCreatePost(context)) return;

    const text = this.postForm.controls.text.value.trim();
    const attachment = this.selectedAttachment();
    if (this.postForm.invalid) {
      this.postForm.markAllAsTouched();
      this.errorNotifier.showWarning(
        'A mensagem deve ter no máximo 1.000 caracteres.'
      );
      return;
    }
    if (!text && !attachment) {
      this.errorNotifier.showWarning(
        'Escreva uma mensagem ou adicione uma foto ou localização.'
      );
      return;
    }

    this.pendingPostRequestId ??= createCommunityFeedRequestId();
    this.postCreateRequests$.next({
      request: {
        requestId: this.pendingPostRequestId,
        communityId: context.communityId.trim(),
        text,
        // Compatibilidade de transporte. O backend deriva a audiência efetiva
        // exclusivamente da visibilidade configurada para a Comunidade.
        audience: 'members_only',
        imageUploadPath: null,
        location: attachment?.kind === 'location'
          ? {
              latitude: attachment.latitude,
              longitude: attachment.longitude,
              precision: attachment.precision,
              accuracyMeters: attachment.accuracyMeters,
            }
          : null,
      },
      attachment,
      context,
    });
  }

  private createMessage$(
    command: CommunityFeedComposerCommand
  ): Observable<CommunityFeedPostCreateResponse> {
    const publish = (imageUploadPath: string | null) =>
      this.repository.createPost$({
        ...command.request,
        imageUploadPath,
      }).pipe(
        catchError((error: unknown) => {
          this.reportPostWriteError(error, command.context);
          return throwError(() => error);
        })
      );

    if (!command.attachment || command.attachment.kind === 'location') {
      return publish(null);
    }

    return this.uploadAttachment$(command.attachment, command.context).pipe(
      switchMap((imageUploadPath) => publish(imageUploadPath))
    );
  }

  private uploadAttachment$(
    attachment: CommunityComposerAttachment,
    context: CommunityFeedComposerContext
  ): Observable<string> {
    switch (attachment.kind) {
      case 'image': {
        const storage = this.injector.get(StorageService);

        return this.resolveUploadUid$(context).pipe(
          tap(() => this.uploadProgress.set(0)),
          switchMap((uid) =>
            storage.uploadFile(
              attachment.file,
              'community-feed',
              uid,
              (progress) => this.uploadProgress.set(
                Math.max(0, Math.min(100, Math.round(progress)))
              )
            )
          ),
          catchError((error: unknown) => {
            if (!this.isUploadSessionError(error)) {
              this.applicationError.report(error, {
                feature: 'community',
                operation: 'uploadFeedImage',
                fallbackMessage: 'Não foi possível enviar a foto agora.',
                metadata: this.errorMetadata(context),
              });
            }
            return throwError(() => error);
          }),
          finalize(() => this.uploadProgress.set(null))
        );
      }
      case 'location':
        return throwError(() =>
          new Error('Localização não requer upload de arquivo.')
        );
    }
  }

  /**
   * Resolve o UID para escrita somente depois de a sessão canônica estar pronta.
   * Cache/perfil runtime não participam desta decisão de identidade.
   */
  private resolveUploadUid$(
    context: CommunityFeedComposerContext
  ): Observable<string> {
    const authSession = this.injector.get(AuthSessionService);

    return authSession.ready$.pipe(
      filter((ready) => ready === true),
      take(1),
      switchMap(() => authSession.readyUid$.pipe(take(1))),
      switchMap((uid) => {
        const cleanUid = String(uid ?? '').trim();
        if (cleanUid) return of(cleanUid);

        const error = new Error('Sessão não encontrada para enviar a foto.');
        (error as Error & { code?: string }).code = COMMUNITY_UPLOAD_SESSION_ERROR_CODE;
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'uploadFeedImage',
          fallbackMessage:
            'Sua sessão precisa ser atualizada para enviar a foto.',
          metadata: this.errorMetadata(context),
        });
        return throwError(() => error);
      })
    );
  }

  private isUploadSessionError(error: unknown): boolean {
    return String((error as { code?: unknown } | null)?.code ?? '')
      === COMMUNITY_UPLOAD_SESSION_ERROR_CODE;
  }

  private createPreviewUrl(file: File): string | null {
    try {
      return typeof URL?.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;
    } catch {
      return null;
    }
  }

  private selectedImagePreviewUrl(): string | null {
    const attachment = this.selectedAttachment();
    return attachment?.kind === 'image' ? attachment.previewUrl : null;
  }

  private revokePreviewUrl(previewUrl: string | null): void {
    if (!previewUrl) return;
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // Preview local descartável; falha de revoke não afeta o fluxo.
    }
  }

  private clearSelectedAttachment(): void {
    this.revokePreviewUrl(this.selectedImagePreviewUrl());
    this.selectedAttachment.set(null);
  }

  private showPostSuccess(deduplicated: boolean): void {
    try {
      this.errorNotifier.showSuccess(
        deduplicated ? 'Mensagem confirmada.' : 'Mensagem enviada.'
      );
    } catch {
      // A atualização reativa do Mural já confirma a operação visualmente.
    }
  }

  private reportPostWriteError(
    error: unknown,
    context: CommunityFeedComposerContext
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'createPost',
      fallbackMessage: 'Não foi possível enviar a mensagem agora.',
      reasonMessages: COMMUNITY_FEED_POST_REASON_MESSAGES,
      codeMessages: COMMUNITY_FEED_POST_CODE_MESSAGES,
      metadata: this.errorMetadata(context),
    });
  }

  private reportLocationError(
    error: unknown,
    context: CommunityFeedComposerContext
  ): void {
    let message = 'Não foi possível obter sua localização agora.';

    if (error instanceof GeolocationError) {
      switch (error.code) {
        case GeolocationErrorCode.PERMISSION_DENIED:
          message = 'Permita o acesso à localização no navegador para compartilhar sua posição.';
          break;
        case GeolocationErrorCode.TIMEOUT:
          message = 'A localização demorou demais para responder. Tente novamente.';
          break;
        case GeolocationErrorCode.UNSUPPORTED:
        case GeolocationErrorCode.INSECURE_CONTEXT:
          message = 'A localização não está disponível neste navegador ou ambiente.';
          break;
        case GeolocationErrorCode.POSITION_UNAVAILABLE:
          message = 'Sua posição não está disponível neste momento.';
          break;
        default:
          break;
      }
    }

    this.applicationError.report(error, {
      feature: 'community',
      operation: 'shareLocation',
      fallbackMessage: message,
      notification: 'warning',
      metadata: this.errorMetadata(context),
    });
  }

  private errorMetadata(context: CommunityFeedComposerContext): Record<string, unknown> {
    return {
      scope: 'CommunityFeedComposerFacade',
      view: context.view,
      sourceType: context.sourceType,
      communityId: context.communityId.trim() || null,
    };
  }
}
