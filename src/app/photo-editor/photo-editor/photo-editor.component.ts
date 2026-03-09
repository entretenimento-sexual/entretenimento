// src/app/photo-editor/photo-editor/photo-editor.component.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { Component, OnInit, ViewChild, input, DestroyRef, inject } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import {
  PinturaEditorOptions,
  getEditorDefaults,
  createDefaultImageReader,
  createDefaultImageWriter,
  PinturaImageState
} from '@pqina/pintura';
import * as locale_pt_br from '@pqina/pintura/locale/pt_PT';
import { Observable, firstValueFrom, lastValueFrom, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { uploadStart } from 'src/app/store/actions/actions.user/file.actions';
import {
  selectFileDownloadUrl,
  selectFileError,
  selectFileSuccess,
  selectFileUploading
} from 'src/app/store/selectors/selectors.user/file.selectors';

import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css'],
  standalone: false
})
export class PhotoEditorComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  readonly imageFile = input.required<File>();
  readonly storedImageUrl = input<string>();
  readonly storedImageState = input<string>();
  readonly photoId = input<string>();
  readonly isEditMode = input<boolean>(false);

  @ViewChild('editor') editor: any;

  src!: string;
  options!: PinturaEditorOptions;
  result?: SafeUrl;
  userId = '';

  isLoading$!: Observable<boolean>;
  errorMessage$!: Observable<string | null>;
  success$!: Observable<boolean>;

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly storageService: StorageService,
    private readonly photoFirestoreService: PhotoFirestoreService,
    public activeModal: NgbActiveModal,
    private readonly authSession: AuthSessionService,
    private readonly store: Store<AppState>,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => (uid ?? '').trim()),
        distinctUntilChanged(),
        catchError((error) => {
          this.errorHandler.handleError(error);
          return of('');
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        this.userId = uid;

        if (!uid) {
          this.errorHandler.handleError(new Error('Usuário não autenticado.'));
          return;
        }

        const storedImageUrl = this.storedImageUrl();
        const imageFile = this.imageFile();

        if (storedImageUrl) {
          this.src = storedImageUrl;
        } else if (imageFile) {
          this.src = URL.createObjectURL(imageFile);
        }

        const storedImageState = this.storedImageState();
        this.options = {
          ...getEditorDefaults(),
          imageReader: createDefaultImageReader({ orientImage: true }),
          imageWriter: createDefaultImageWriter({
            copyImageHead: false,
            quality: 0.8
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
          imageState: storedImageState ? JSON.parse(storedImageState) : undefined,
        };

        this.isLoading$ = this.store.select(selectFileUploading);
        this.errorMessage$ = this.store.select(selectFileError);
        this.success$ = this.store.select(selectFileSuccess);
      });
  }

  async handleProcess(event: any): Promise<void> {
    const objectURL = URL.createObjectURL(event.dest);
    this.result = this.sanitizer.bypassSecurityTrustResourceUrl(objectURL) as SafeUrl;

    const imageStateStr = this.stringifyImageState(event.imageState);
    await this.saveImageState(imageStateStr).catch(error => this.errorHandler.handleError(error));

    if (this.isEditMode() && this.storedImageUrl() && this.photoId()) {
      await this.updateStoredFile(event.dest).catch(error => this.errorHandler.handleError(error));
    } else {
      await this.uploadProcessedFile(event.dest).catch(error => this.errorHandler.handleError(error));
    }
  }

  async uploadProcessedFile(processedFile: Blob): Promise<void> {
    if (!this.userId) {
      this.errorHandler.handleError(new Error('Usuário não autenticado.'));
      return;
    }

    const fileName = `${Date.now()}_${this.imageFile().name}`;
    const path = `user_profiles/${this.userId}/${fileName}`;
    const file = new File([processedFile], fileName, { type: this.imageFile().type });

    this.store.dispatch(uploadStart({ file, path, userId: this.userId, fileName }));

    const success = await firstValueFrom(this.success$);
    if (success) {
      const downloadUrl = await firstValueFrom(this.store.select(selectFileDownloadUrl));
      const photoId = Date.now().toString();

      await this.photoFirestoreService.savePhotoMetadata(this.userId, {
        id: photoId,
        url: downloadUrl!,
        fileName,
        createdAt: new Date()
      });

      this.activeModal.close('uploadSuccess');
      this.errorNotifier.showSuccess('Imagem enviada com sucesso!');
    }
  }

  async updateStoredFile(processedFile: Blob): Promise<void> {
    const storedImageUrl = this.storedImageUrl();
    const photoId = this.photoId();

    if (!this.userId || !storedImageUrl || !photoId) {
      this.errorHandler.handleError(new Error('Informações incompletas para a substituição da foto.'));
      return;
    }

    const filePath = storedImageUrl;
    const file = new File([processedFile], `edited_${this.imageFile().name}`, { type: this.imageFile().type });

    try {
      const downloadUrl = await lastValueFrom(this.storageService.replaceFile(file, filePath));

      await this.photoFirestoreService.updatePhotoMetadata(this.userId, photoId, { url: downloadUrl });

      this.activeModal.close('updateSuccess');
      this.errorNotifier.showSuccess('Imagem atualizada com sucesso!');
    } catch (error: any) {
      this.errorHandler.handleError(error);
    }
  }

  async saveImageState(imageStateStr: string): Promise<void> {
    if (!this.userId) {
      this.errorHandler.handleError(new Error('Usuário não autenticado.'));
      return;
    }

    try {
      await this.photoFirestoreService.saveImageState(this.userId, imageStateStr);
    } catch (error: any) {
      this.errorHandler.handleError(error);
    }
  }

  stringifyImageState(imageState: PinturaImageState): string {
    return JSON.stringify(imageState, (k, v) => (v === undefined ? null : v));
  }

  parseImageState(str: string): PinturaImageState {
    return JSON.parse(str);
  }
} // linha 217
