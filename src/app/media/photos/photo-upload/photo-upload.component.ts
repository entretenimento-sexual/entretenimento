// src/app/media/photos/photo-upload/photo-upload.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
//
// PACOTE DE INTEGRAÇÃO DO EDITOR:
// - mantém upload direto com progresso real
// - adiciona fluxo "Editar antes de enviar"
// - usa canUploadProfilePhotos$ (policy correta de upload)
// - mantém preview local e pós-upload com escolha do usuário
// - mantém tratamento centralizado de erro
// - limpa a sessão efêmera do editor com segurança

import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  MediaPolicyService,
  IMediaPolicyResult,
} from 'src/app/core/services/media/media-policy.service';
import {
  PhotoUploadFlowService,
  IPhotoUploadFlowEvent,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { PhotoEditorSessionService } from 'src/app/core/services/image-handling/photo-editor-session.service';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

type UploadPhase = 'IDLE' | 'READY' | 'UPLOADING' | 'DONE';

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
  private readonly modal = inject(NgbModal);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly photoUploadFlow = inject(PhotoUploadFlowService);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);

  private readonly DEBUG = true;

  private readonly allowedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

  private readonly maxFileSizeBytes = 10 * 1024 * 1024; // 10 MB

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.revokePreviewUrl();
      this.photoEditorSession.clearDraft();
    });
  }

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((p) => p.get('id') ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewerUid$,
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, owner]) =>
      owner
        ? this.policy.canUploadProfilePhotos$(viewer, owner)
        : of<IMediaPolicyResult>({ decision: 'DENY', reason: 'UNKNOWN' })
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

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$: Observable<string | null> = this.previewUrlSubject.asObservable();

  private readonly phaseSubject = new BehaviorSubject<UploadPhase>('IDLE');
  readonly phase$: Observable<UploadPhase> = this.phaseSubject.asObservable();

  private readonly uploadedPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly uploadedPhotoId$: Observable<string | null> = this.uploadedPhotoIdSubject.asObservable();

  private readonly uploadPercentSubject = new BehaviorSubject<number>(0);
  readonly uploadPercent$: Observable<number> = this.uploadPercentSubject.asObservable();

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

    if (!this.allowedMimeTypes.has(file.type)) {
      this.errorNotifier.showError('Formato inválido. Envie JPG, PNG ou WEBP.');
      input.value = '';
      return;
    }

    if (file.size > this.maxFileSizeBytes) {
      this.errorNotifier.showError('A imagem excede o limite de 10 MB.');
      input.value = '';
      return;
    }

    this.revokePreviewUrl();

    const url = URL.createObjectURL(file);

    this.fileSubject.next(file);
    this.previewUrlSubject.next(url);
    this.phaseSubject.next('READY');
    this.uploadedPhotoIdSubject.next(null);
    this.uploadPercentSubject.next(0);

    this.debug('fileSelected', {
      name: file.name,
      type: file.type,
      size: file.size,
    });
  }

  startUpload(): void {
    combineLatest([this.canUpload$, this.file$, this.ownerUid$, this.phase$])
      .pipe(
        take(1),
        switchMap(([can, file, ownerUid, phase]) => {
          if (phase === 'UPLOADING') {
            return EMPTY;
          }

          if (!can) {
            this.errorNotifier.showError('Você não tem permissão para enviar fotos.');
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

          this.phaseSubject.next('UPLOADING');
          this.uploadPercentSubject.next(0);

          return this.photoUploadFlow.uploadProcessedPhotoWithProgress$({
            userId: ownerUid,
            processedFile: file,
            originalFileName: file.name,
            mimeType: file.type,
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
              this.errorNotifier.showSuccess('Upload concluído com sucesso.');
            }),
            catchError((error) => {
              this.phaseSubject.next('READY');
              this.uploadPercentSubject.next(0);
              this.reportError(
                'Erro ao enviar a imagem.',
                error,
                {
                  op: 'startUpload',
                  ownerUid,
                  fileName: file.name,
                }
              );
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  editBeforeUpload(): void {
    combineLatest([this.canUpload$, this.file$, this.ownerUid$, this.phase$])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(([canUpload, file, ownerUid, phase]) => {
        if (phase === 'UPLOADING') {
          return;
        }

        if (!canUpload) {
          this.errorNotifier.showError('Você não tem permissão para editar e enviar fotos.');
          return;
        }

        if (!ownerUid?.trim()) {
          this.reportError(
            'Não foi possível identificar o perfil de destino.',
            new Error('ownerUid ausente na rota.'),
            { op: 'editBeforeUpload.ownerUid' }
          );
          return;
        }

        if (!file) {
          this.errorNotifier.showError('Selecione uma imagem antes de editar.');
          return;
        }

        this.photoEditorSession.setCreateDraft(file, ownerUid);

        const modalRef = this.modal.open(PhotoEditorComponent, {
          size: 'xl',
          centered: true,
          backdrop: 'static',
          keyboard: false,
          scrollable: true,
          windowClass: 'photo-editor-modal-window',
        });

        modalRef.result
          .then((payload) => {
            if (!payload || payload.reason !== 'uploadSuccess' || !payload.photo) {
              return;
            }

            this.phaseSubject.next('DONE');
            this.uploadedPhotoIdSubject.next(payload.photo.photoId ?? null);
            this.uploadPercentSubject.next(100);

            if (payload.photo.url) {
              this.revokePreviewUrl();
              this.previewUrlSubject.next(payload.photo.url);
            }

            this.fileSubject.next(null);
            this.errorNotifier.showSuccess('Foto editada e enviada com sucesso.');
          })
          .catch(() => {
            // dismiss do modal: não tratar como erro visível
          })
          .finally(() => {
            this.photoEditorSession.clearDraft();
          });
      });
  }

  resetSelection(fileInput?: HTMLInputElement): void {
    this.revokePreviewUrl();
    this.fileSubject.next(null);
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

  private revokePreviewUrl(): void {
    const previous = this.previewUrlSubject.value;
    if (previous?.startsWith('blob:')) {
      URL.revokeObjectURL(previous);
    }
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
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
      // noop
    }

    this.debug('reportError', { userMessage, context, error });
  }

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[PhotoUpload] ${msg}`, data ?? '');
  }
} // Linha 396