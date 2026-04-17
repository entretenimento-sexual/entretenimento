// src/app/photo-editor/photo-editor/photo-editor.component.ts
// Editor de foto com suporte a:
// - create: arquivo recém-selecionado
// - edit: foto já persistida, aberta da galeria
//
// AJUSTES DESTA VERSÃO:
// - resolve dados a partir de inputs OU sessão efêmera
// - suporta replace real a partir da galeria
// - mantém upload/replace reais via PhotoUploadFlowService
// - mantém tratamento centralizado de erro
// - limpa sessão e blob URL no destroy
import { Component, OnInit, input, DestroyRef, inject } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import {
  PinturaEditorOptions,
  getEditorDefaults,
  createDefaultImageReader,
  createDefaultImageWriter,
  PinturaImageState,
} from '@pqina/pintura';
import * as locale_pt_br from '@pqina/pintura/locale/pt_PT';
import { BehaviorSubject, Observable, firstValueFrom, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  PhotoUploadFlowService,
  IPhotoFlowResult,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import {
  PhotoEditorSessionService,
  IPhotoEditorDraft,
} from 'src/app/core/services/image-handling/photo-editor-session.service';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css'],
  standalone: false,
})
export class PhotoEditorComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);

  readonly imageFile = input<File | null>(null);
  readonly storedImageUrl = input<string | null>(null);
  readonly storedImagePath = input<string | null>(null);
  readonly storedImageState = input<string | null>(null);
  readonly photoId = input<string | null>(null);
  readonly isEditMode = input<boolean>(false);

  src = '';
  options!: PinturaEditorOptions;
  userId = '';

  private sourceFile: File | null = null;
  private sourceObjectUrl: string | null = null;
  private activeDraft: IPhotoEditorDraft | null = null;

  private effectiveIsEditMode = false;
  private effectiveStoredImageUrl: string | null = null;
  private effectiveStoredImagePath: string | null = null;
  private effectiveStoredImageState: string | null = null;
  private effectivePhotoId: string | null = null;

  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);
  private readonly errorMessageSubject = new BehaviorSubject<string | null>(null);

  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();
  readonly errorMessage$: Observable<string | null> = this.errorMessageSubject.asObservable();

  private readonly DEBUG = true;

  constructor(
    private readonly photoUploadFlow: PhotoUploadFlowService,
    public activeModal: NgbActiveModal,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {
    this.destroyRef.onDestroy(() => {
      this.revokeSourceObjectUrl();
      this.photoEditorSession.clearDraft();
    });
  }

  ngOnInit(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => (uid ?? '').trim()),
        distinctUntilChanged(),
        catchError((error) => {
          this.reportError('Erro ao preparar o editor de imagem.', error, {
            op: 'ngOnInit.uid$',
          });
          return of('');
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        this.userId = uid;

        if (!uid) {
          this.failAndDismiss(
            'Usuário não autenticado.',
            new Error('Usuário não autenticado.'),
            'user-not-authenticated',
            { op: 'ngOnInit.user' }
          );
          return;
        }

        const sessionDraft = this.photoEditorSession.peekDraft();
        this.activeDraft = sessionDraft;

        if (!this.validateDraftOwnership(sessionDraft, uid)) {
          this.failAndDismiss(
            'Você não tem permissão para editar esta imagem.',
            new Error('ownerUid da sessão não corresponde ao usuário autenticado.'),
            'invalid-editor-session',
            {
              op: 'ngOnInit.sessionOwnership',
              authUid: uid,
            }
          );
          return;
        }

        this.resolveEffectiveState(sessionDraft);

        const sourceResolved = this.resolveSource();
        if (!sourceResolved) {
          this.failAndDismiss(
            'Nenhuma imagem disponível para edição.',
            new Error('Editor aberto sem imagem de origem.'),
            'missing-editor-source',
            { op: 'ngOnInit.source' }
          );
          return;
        }

        const parsedImageState = this.safeParseImageState(this.effectiveStoredImageState);

        this.options = this.buildEditorOptions(parsedImageState);

        this.debug('init', {
          uid,
          effectiveIsEditMode: this.effectiveIsEditMode,
          hasSourceFile: !!this.sourceFile,
          hasStoredImageUrl: !!this.effectiveStoredImageUrl,
          hasStoredImagePath: !!this.effectiveStoredImagePath,
          hasPhotoId: !!this.effectivePhotoId,
        });
      });
  }

  async handleProcess(event: any): Promise<void> {
    const imageStateStr = this.stringifyImageState(event.imageState);

    if (this.effectiveIsEditMode) {
      await this.updateStoredFile(event.dest, imageStateStr);
      return;
    }

    await this.uploadProcessedFile(event.dest, imageStateStr);
  }

  async uploadProcessedFile(processedFile: Blob, imageStateStr: string): Promise<void> {
    if (!this.userId) {
      this.reportError('Usuário não autenticado.', new Error('Usuário não autenticado.'), {
        op: 'uploadProcessedFile',
      });
      return;
    }

    const originalMeta = this.resolveOriginalFileMetadata();
    if (!originalMeta) {
      this.reportError(
        'Imagem de origem indisponível para envio.',
        new Error('Não foi possível resolver metadados do arquivo de origem.'),
        {
          op: 'uploadProcessedFile.originalMeta',
          userId: this.userId,
        }
      );
      return;
    }

    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null);

    try {
      const result = await firstValueFrom(
        this.photoUploadFlow.uploadProcessedPhoto$({
          userId: this.userId,
          processedFile,
          originalFileName: originalMeta.fileName,
          mimeType: originalMeta.mimeType,
          imageStateStr,
        })
      );

      this.closeWithSuccess('uploadSuccess', result);
    } catch (error) {
      this.reportError('Erro ao enviar a imagem.', error, {
        op: 'uploadProcessedFile',
        userId: this.userId,
      });
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  async updateStoredFile(processedFile: Blob, imageStateStr: string): Promise<void> {
    const safePhotoId = (this.effectivePhotoId ?? '').trim();
    const safeStoredImagePath = (this.effectiveStoredImagePath ?? '').trim();

    if (!this.userId || !safePhotoId || !safeStoredImagePath) {
      this.reportError(
        'Informações incompletas para a substituição da foto.',
        new Error('Edição sem storagePath válido.'),
        {
          op: 'updateStoredFile',
          userId: this.userId,
          photoId: safePhotoId,
          storedImagePath: safeStoredImagePath,
        }
      );
      return;
    }

    const originalMeta = this.resolveOriginalFileMetadata();
    if (!originalMeta) {
      this.reportError(
        'Imagem de origem indisponível para atualização.',
        new Error('Não foi possível resolver metadados do arquivo de origem.'),
        {
          op: 'updateStoredFile.originalMeta',
          userId: this.userId,
          photoId: safePhotoId,
        }
      );
      return;
    }

    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null);

    try {
      const result = await firstValueFrom(
        this.photoUploadFlow.replaceProcessedPhoto$({
          userId: this.userId,
          photoId: safePhotoId,
          currentStoragePath: safeStoredImagePath,
          processedFile,
          originalFileName: originalMeta.fileName,
          mimeType: originalMeta.mimeType,
          imageStateStr,
        })
      );

      this.closeWithSuccess('updateSuccess', result);
    } catch (error) {
      this.reportError('Erro ao atualizar a imagem.', error, {
        op: 'updateStoredFile',
        userId: this.userId,
        photoId: safePhotoId,
      });
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  stringifyImageState(imageState: PinturaImageState): string {
    return JSON.stringify(imageState, (_key, value) => (value === undefined ? null : value));
  }

  parseImageState(str: string): PinturaImageState {
    return JSON.parse(str);
  }

  private buildEditorOptions(imageState?: PinturaImageState): PinturaEditorOptions {
    return {
      ...getEditorDefaults(),
      imageReader: createDefaultImageReader({ orientImage: true }),
      imageWriter: createDefaultImageWriter({
        copyImageHead: false,
        quality: 0.8,
      }),
      locale: locale_pt_br,
      enableToolbar: true,
      enableButtonExport: true,
      enableButtonRevert: true,
      enableDropImage: true,
      enableBrowseImage: false,
      enablePan: true,
      enableZoom: true,
      zoomLevel: 1,
      previewUpscale: true,
      enableTransparencyGrid: true,
      imageCropAspectRatio: undefined,
      imageCrop: undefined,
      imageBackgroundColor: [255, 255, 255, 0],
      imageState,
    };
  }

  private validateDraftOwnership(
    sessionDraft: IPhotoEditorDraft | null,
    authUid: string
  ): boolean {
    if (!sessionDraft) return true;
    return sessionDraft.ownerUid === authUid;
  }

  private resolveEffectiveState(sessionDraft: IPhotoEditorDraft | null): void {
    this.effectiveIsEditMode = this.isEditMode() || sessionDraft?.mode === 'edit';

    this.effectiveStoredImageUrl =
      (this.storedImageUrl() ?? '').trim() ||
      (sessionDraft?.mode === 'edit' ? sessionDraft.storedImageUrl : '') ||
      null;

    this.effectiveStoredImagePath =
      (this.storedImagePath() ?? '').trim() ||
      (sessionDraft?.mode === 'edit' ? sessionDraft.storedImagePath : '') ||
      null;

    this.effectiveStoredImageState =
      (this.storedImageState() ?? '').trim() ||
      (sessionDraft?.mode === 'edit' ? (sessionDraft.storedImageState ?? '') : '') ||
      null;

    this.effectivePhotoId =
      (this.photoId() ?? '').trim() ||
      (sessionDraft?.mode === 'edit' ? sessionDraft.photoId : '') ||
      null;
  }

  private resolveSource(): boolean {
    const inputFile = this.imageFile();

    this.sourceFile =
      inputFile ??
      (this.activeDraft?.mode === 'create' ? this.activeDraft.file : null);

    if (this.effectiveStoredImageUrl) {
      this.src = this.effectiveStoredImageUrl;
      return true;
    }

    if (this.sourceFile) {
      this.revokeSourceObjectUrl();
      this.sourceObjectUrl = URL.createObjectURL(this.sourceFile);
      this.src = this.sourceObjectUrl;
      return true;
    }

    return false;
  }

  private resolveOriginalFileMetadata():
    | { fileName: string; mimeType: string }
    | null {
    if (this.sourceFile) {
      return {
        fileName: this.sourceFile.name,
        mimeType: this.sourceFile.type || 'image/jpeg',
      };
    }

    const draftFileName =
      this.activeDraft?.mode === 'edit'
        ? (this.activeDraft.fileName ?? '')
        : '';

    const storedPath = (this.effectiveStoredImagePath ?? '').trim();
    const storedUrl = (this.effectiveStoredImageUrl ?? '').trim();
    const safePhotoId = (this.effectivePhotoId ?? '').trim();

    const fallbackName =
      draftFileName ||
      this.extractFileNameFromPath(storedPath) ||
      this.extractFileNameFromUrl(storedUrl) ||
      `${safePhotoId || Date.now()}.jpg`;

    const fallbackMimeType = this.inferMimeTypeFromFileName(fallbackName);

    return {
      fileName: fallbackName,
      mimeType: fallbackMimeType,
    };
  }

  private extractFileNameFromPath(path: string): string | null {
    if (!path) return null;

    const normalized = path.replace(/\\/g, '/');
    const lastSegment = normalized.split('/').pop()?.trim() ?? '';

    return lastSegment || null;
  }

  private extractFileNameFromUrl(url: string): string | null {
    if (!url) return null;

    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname ?? '');
      const lastSegment = pathname.split('/').pop()?.trim() ?? '';
      return lastSegment || null;
    } catch {
      return null;
    }
  }

  private inferMimeTypeFromFileName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

    switch (ext) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  private safeParseImageState(str: string | null | undefined): PinturaImageState | undefined {
    const safe = (str ?? '').trim();
    if (!safe) return undefined;

    try {
      return this.parseImageState(safe);
    } catch (error) {
      this.reportError(
        'Não foi possível restaurar o estado anterior da imagem.',
        error,
        { op: 'safeParseImageState' }
      );
      return undefined;
    }
  }

  private revokeSourceObjectUrl(): void {
    if (this.sourceObjectUrl) {
      URL.revokeObjectURL(this.sourceObjectUrl);
      this.sourceObjectUrl = null;
    }
  }

  private closeWithSuccess(
    reason: 'uploadSuccess' | 'updateSuccess',
    photo: IPhotoFlowResult
  ): void {
    this.photoEditorSession.clearDraft();
    this.activeModal.close({ reason, photo });
  }

  private failAndDismiss(
    userMessage: string,
    error: unknown,
    dismissReason: string,
    context?: Record<string, unknown>
  ): void {
    this.reportError(userMessage, error, context);
    this.activeModal.dismiss(dismissReason);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    this.errorMessageSubject.next(userMessage);

    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'PhotoEditorComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }

    this.debug('reportError', {
      userMessage,
      context,
      error,
    });
  }

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[PhotoEditor] ${msg}`, data ?? '');
  }
} // Linha 515