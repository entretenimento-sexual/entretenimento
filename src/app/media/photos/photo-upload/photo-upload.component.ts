// src/app/media/photos/photo-upload/photo-upload.component.ts
// Fluxo reativo de seleção, edição canônica e envio de fotos do perfil.
// O editor apenas processa a imagem; a persistência pertence a este fluxo.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import {
  IPhotoUploadFlowEvent,
  PhotoUploadFlowService,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyDenyReason,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import { environment } from 'src/environments/environment';

const DENY_UNKNOWN: IMediaPolicyResult = { decision: 'DENY', reason: 'UNKNOWN' };

type UploadPhase = 'IDLE' | 'EDITING' | 'READY' | 'UPLOADING' | 'DONE';

@Component({
  selector: 'app-photo-upload',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './photo-upload.component.html',
  styleUrls: ['./photo-upload.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoUploadComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly photoUploadFlow = inject(PhotoUploadFlowService);
  private readonly photoEditor = inject(PhotoEditorLauncherService);

  private readonly DEBUG =
    !environment.production &&
    localStorage.getItem('debug.photo-upload') === '1';

  readonly imageAccept = MEDIA_IMAGE_ACCEPT;
  readonly imageFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  readonly imageMaxMegabytes = resolveImageMaxBytes('default') / 1024 / 1024;

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewUrl());
  }

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((p) => p.get('id') ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewer$: Observable<IMediaPolicyViewerSnapshot | null | undefined> =
    this.currentUserStore.user$.pipe(
      map((user) =>
        user
          ? {
              uid: user.uid,
              emailVerified: user.emailVerified === true,
              profileCompleted: user.profileCompleted === true,
              interactionBlocked: user.interactionBlocked === true,
            }
          : user
      ),
      distinctUntilChanged((previous, current) =>
        previous === current ||
        (!!previous &&
          !!current &&
          previous.uid === current.uid &&
          previous.emailVerified === current.emailVerified &&
          previous.profileCompleted === current.profileCompleted &&
          previous.interactionBlocked === current.interactionBlocked)
      ),
      tap((viewer) =>
        this.debug('viewer$', {
          resolved: viewer !== undefined,
          hasViewerUid: !!viewer?.uid,
          emailVerified: viewer?.emailVerified === true,
          profileCompleted: viewer?.profileCompleted === true,
          interactionBlocked: viewer?.interactionBlocked === true,
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly viewerUid$: Observable<string | null> = this.viewer$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewer$,
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, owner]) =>
      owner
        ? this.policy.canUploadProfilePhotosForViewer$(viewer, owner)
        : of(DENY_UNKNOWN)
    ),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canUpload$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  private readonly fileSubject = new BehaviorSubject<File | null>(null);
  readonly file$: Observable<File | null> = this.fileSubject.asObservable();

  private readonly imageStateSubject = new BehaviorSubject<string | null>(null);
  readonly imageState$: Observable<string | null> = this.imageStateSubject.asObservable();

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$: Observable<string | null> =
    this.previewUrlSubject.asObservable();

  private readonly phaseSubject = new BehaviorSubject<UploadPhase>('IDLE');
  readonly phase$: Observable<UploadPhase> = this.phaseSubject.asObservable();

  private readonly uploadedPhotoIdSubject = new BehaviorSubject<string | null>(
    null
  );
  readonly uploadedPhotoId$: Observable<string | null> =
    this.uploadedPhotoIdSubject.asObservable();

  private readonly uploadPercentSubject = new BehaviorSubject<number>(0);
  readonly uploadPercent$: Observable<number> =
    this.uploadPercentSubject.asObservable();

  readonly selectedFileName$: Observable<string | null> = this.file$.pipe(
    map((file) => file?.name ?? null),
    distinctUntilChanged()
  );

  readonly selectedFileSizeLabel$: Observable<string | null> = this.file$.pipe(
    map((file) => (file ? this.formatBytes(file.size) : null)),
    distinctUntilChanged()
  );

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    input.value = '';

    const validation = validateImageMediaFile(file, 'default');
    if (!validation.valid) {
      this.errorNotifier.showError(
        validation.userMessage ?? 'A imagem selecionada não é válida.'
      );
      return;
    }

    combineLatest([this.policyResult$, this.ownerUid$, this.phase$])
      .pipe(
        take(1),
        switchMap(([policyResult, ownerUid, phase]) => {
          if (phase === 'UPLOADING' || phase === 'EDITING') {
            return EMPTY;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showError(
              this.getPolicyDeniedMessage(policyResult.reason, 'adicionar fotos')
            );
            return EMPTY;
          }

          if (!ownerUid?.trim()) {
            this.reportError(
              'Não foi possível identificar o perfil de destino.',
              new Error('ownerUid ausente na rota.'),
              { op: 'onFileSelected.ownerUid' }
            );
            return EMPTY;
          }

          const fallbackPhase: UploadPhase = this.fileSubject.value
            ? 'READY'
            : 'IDLE';
          this.phaseSubject.next('EDITING');

          return this.photoEditor
            .editFile$(file, {
              source: 'photo-upload',
              context: 'profile-photo',
              preset: 'profile-photo',
            })
            .pipe(
              tap((result) => {
                if (!result) {
                  return;
                }

                const processedValidation = validateImageMediaFile(
                  result.file,
                  'default'
                );
                if (!processedValidation.valid) {
                  this.errorNotifier.showError(
                    processedValidation.userMessage ?? 'A imagem editada não é válida.'
                  );
                  return;
                }

                this.applySelectedFile(result.file, result.imageStateStr);
                this.debug('fileSelectedAndEdited', {
                  name: result.file.name,
                  type: result.file.type,
                  size: result.file.size,
                  metadataStripped: result.metadataStripped,
                });
              }),
              catchError((error) => {
                this.reportError('Erro ao editar a imagem.', error, {
                  op: 'onFileSelected.editor',
                  ownerUid,
                  fileName: file.name,
                });
                return EMPTY;
              }),
              finalize(() => {
                if (this.phaseSubject.value === 'EDITING') {
                  this.phaseSubject.next(fallbackPhase);
                }
              })
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  startUpload(): void {
    combineLatest([
      this.policyResult$,
      this.file$,
      this.ownerUid$,
      this.phase$,
      this.imageState$,
    ])
      .pipe(
        take(1),
        switchMap(([policyResult, file, ownerUid, phase, imageStateStr]) => {
          if (phase === 'UPLOADING' || phase === 'EDITING') {
            return EMPTY;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showError(
              this.getPolicyDeniedMessage(policyResult.reason, 'enviar fotos')
            );
            return EMPTY;
          }

          if (!ownerUid?.trim()) {
            this.reportError(
              'Não foi possível identificar o perfil de destino.',
              new Error('ownerUid ausente na rota.'),
              { op: 'startUpload.ownerUid' }
            );
            return EMPTY;
          }

          if (!file) {
            this.errorNotifier.showError('Selecione uma imagem antes de enviar.');
            return EMPTY;
          }

          if (!imageStateStr) {
            this.errorNotifier.showError(
              'Confirme a foto no editor antes de enviar.'
            );
            return EMPTY;
          }

          this.phaseSubject.next('UPLOADING');
          this.uploadPercentSubject.next(0);

          return this.uploadSelectedFile$(
            ownerUid,
            file,
            imageStateStr,
            'Upload concluído com sucesso.'
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  editBeforeUpload(): void {
    combineLatest([this.policyResult$, this.file$, this.ownerUid$, this.phase$])
      .pipe(
        take(1),
        switchMap(([policyResult, file, ownerUid, phase]) => {
          if (phase !== 'READY') {
            return EMPTY;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showError(
              this.getPolicyDeniedMessage(policyResult.reason, 'editar fotos')
            );
            return EMPTY;
          }

          if (!ownerUid?.trim()) {
            this.reportError(
              'Não foi possível identificar o perfil de destino.',
              new Error('ownerUid ausente na rota.'),
              { op: 'editBeforeUpload.ownerUid' }
            );
            return EMPTY;
          }

          if (!file) {
            this.errorNotifier.showError('Selecione uma imagem antes de editar.');
            return EMPTY;
          }

          this.phaseSubject.next('EDITING');

          return this.photoEditor
            .editFile$(file, {
              source: 'photo-upload',
              context: 'profile-photo',
              preset: 'profile-photo',
            })
            .pipe(
              tap((result) => {
                if (!result) {
                  return;
                }

                const validation = validateImageMediaFile(result.file, 'default');
                if (!validation.valid) {
                  this.errorNotifier.showError(
                    validation.userMessage ?? 'A imagem editada não é válida.'
                  );
                  return;
                }

                this.applySelectedFile(result.file, result.imageStateStr);
              }),
              catchError((error) => {
                this.reportError('Erro ao editar a imagem.', error, {
                  op: 'editBeforeUpload.editor',
                  ownerUid,
                  fileName: file.name,
                });
                return EMPTY;
              }),
              finalize(() => {
                if (this.phaseSubject.value === 'EDITING') {
                  this.phaseSubject.next('READY');
                }
              })
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  resetSelection(fileInput?: HTMLInputElement): void {
    if (this.phaseSubject.value === 'UPLOADING' || this.phaseSubject.value === 'EDITING') {
      return;
    }

    this.revokePreviewUrl();
    this.fileSubject.next(null);
    this.imageStateSubject.next(null);
    this.previewUrlSubject.next(null);
    this.phaseSubject.next('IDLE');
    this.uploadedPhotoIdSubject.next(null);
    this.uploadPercentSubject.next(0);

    if (fileInput) {
      fileInput.value = '';
    }
  }

  sendAnotherPhoto(): void {
    this.resetSelection();
  }

  backToPhotos(ownerUid: string): void {
    this.router.navigate(['/media', 'perfil', ownerUid, 'fotos']).catch((error) => {
      this.reportError(
        'Falha ao navegar.',
        error,
        { op: 'backToPhotos', ownerUid }
      );
    });
  }

  private uploadSelectedFile$(
    ownerUid: string,
    file: File,
    imageStateStr: string,
    successMessage: string
  ): Observable<IPhotoUploadFlowEvent> {
    return this.photoUploadFlow.uploadProcessedPhotoWithProgress$({
      userId: ownerUid,
      processedFile: file,
      originalFileName: file.name,
      mimeType: file.type,
      imageStateStr,
    }).pipe(
      tap((event: IPhotoUploadFlowEvent) => {
        if (event.type === 'progress') {
          this.uploadPercentSubject.next(event.progress);
          return;
        }

        this.debug('uploadSuccess', event.result);
        this.phaseSubject.next('DONE');
        this.uploadedPhotoIdSubject.next(event.result.photoId);
        this.uploadPercentSubject.next(100);

        if (event.result.url) {
          this.revokePreviewUrl();
          this.previewUrlSubject.next(event.result.url);
        }

        this.fileSubject.next(null);
        this.imageStateSubject.next(null);
        this.errorNotifier.showSuccess(successMessage);
      }),
      catchError((error) => {
        this.phaseSubject.next('READY');
        this.uploadPercentSubject.next(0);
        this.reportError(
          'Erro ao enviar a imagem.',
          error,
          {
            op: 'uploadSelectedFile',
            ownerUid,
            fileName: file.name,
          }
        );
        return EMPTY;
      })
    );
  }

  private applySelectedFile(
    file: File,
    imageStateStr: string
  ): void {
    this.revokePreviewUrl();

    let previewUrl: string | null = null;
    try {
      previewUrl = URL.createObjectURL(file);
    } catch {
      previewUrl = null;
    }

    this.fileSubject.next(file);
    this.imageStateSubject.next(imageStateStr);
    this.previewUrlSubject.next(previewUrl);
    this.phaseSubject.next('READY');
    this.uploadedPhotoIdSubject.next(null);
    this.uploadPercentSubject.next(0);
  }

  private revokePreviewUrl(): void {
    const previous = this.previewUrlSubject.value;
    if (previous?.startsWith('blob:')) {
      URL.revokeObjectURL(previous);
    }
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );
    const value = bytes / Math.pow(1024, index);

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  private getPolicyDeniedMessage(
    reason: MediaPolicyDenyReason | undefined,
    actionLabel: string
  ): string {
    switch (reason) {
      case 'NOT_AUTHENTICATED':
        return `Faça login para ${actionLabel}.`;
      case 'NOT_OWNER':
        return `Você só pode ${actionLabel} no seu próprio perfil.`;
      case 'EMAIL_UNVERIFIED':
        return `Confirme seu e-mail antes de ${actionLabel}.`;
      case 'PROFILE_INCOMPLETE':
        return `Finalize seu cadastro antes de ${actionLabel}.`;
      case 'INTERACTION_BLOCKED':
      case 'BLOCKED':
        return `Sua conta não pode ${actionLabel} no momento.`;
      case 'SUBSCRIPTION_REQUIRED':
        return `Assinatura necessária para ${actionLabel}.`;
      default:
        return `Não foi possível autorizar ${actionLabel} agora.`;
    }
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // A notificação não pode interromper o fluxo de erro centralizado.
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'PhotoUploadComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // A telemetria não pode quebrar o fluxo da interface.
    }

    this.debug('reportError', { userMessage, context, error });
  }

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) {
      return;
    }

    // eslint-disable-next-line no-console
    console.debug(`[PhotoUpload] ${msg}`, data ?? '');
  }
}
