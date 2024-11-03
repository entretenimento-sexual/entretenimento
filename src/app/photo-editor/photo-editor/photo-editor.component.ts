// src/app/photo-editor/photo-editor/photo-editor.component.ts
import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import {
  PinturaEditorOptions,
  getEditorDefaults,
  createDefaultImageReader,
  createDefaultImageWriter,
  PinturaImageState
} from '@pqina/pintura';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import * as locale_pt_br from '@pqina/pintura/locale/pt_PT';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Observable, firstValueFrom, lastValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { uploadStart } from 'src/app/store/actions/actions.user/file.actions';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { selectFileDownloadUrl, selectFileError, selectFileSuccess, selectFileUploading } from 'src/app/store/selectors/selectors.user/file.selectors';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})

export class PhotoEditorComponent implements OnInit {
  @Input() imageFile!: File;                // Arquivo local da imagem a ser editada
  @Input() storedImageUrl?: string;         // URL da imagem armazenada para edição
  @Input() storedImageState?: string;       // Estado anterior da imagem (se houver)
  @Input() photoId?: string;                // ID da foto para atualizar metadados
  @Input() isEditMode: boolean = false;     // Flag para determinar se é uma edição de foto armazenada

  // Referência ao componente do editor de imagem
  @ViewChild('editor') editor: any;

  src!: string;                             // Fonte da imagem para o editor
  options!: PinturaEditorOptions;           // Opções de configuração do editor
  result?: SafeUrl;                         // Resultado da imagem processada
  userId!: string;                          // ID do usuário autenticado

  // Observables para gerenciamento de estado com NgRx
  isLoading$!: Observable<boolean>;
  errorMessage$!: Observable<string | null>;
  success$!: Observable<boolean>;

  constructor(
    private sanitizer: DomSanitizer,                           // Para sanitizar URLs
    private storageService: StorageService,                    // Serviço para interagir com o Firebase Storage
    private photoFirestoreService: PhotoFirestoreService,      // Serviço para interagir com o Firestore
    public activeModal: NgbActiveModal,                        // Modal ativo (do NgbModal)
    private authService: AuthService,                          // Serviço de autenticação
    private store: Store<AppState>,                            // Store do NgRx
    private errorHandler: GlobalErrorHandlerService,                  // Handler global de erros
    private errorNotifier: ErrorNotificationService            // Serviço para notificar erros
  ) { }

  ngOnInit(): void {
    // Obtém o usuário autenticado
    this.authService.user$.subscribe(
      (user: IUserDados | null) => {
        if (user && user.uid) {
          this.userId = user.uid;

          // Configura a fonte da imagem
          if (this.storedImageUrl) {
            // Carrega a imagem armazenada
            this.src = this.storedImageUrl;
          } else if (this.imageFile) {
            // Carrega o arquivo local
            this.src = URL.createObjectURL(this.imageFile);
          }

          // Configura as opções do editor de imagem
          this.options = {
            ...getEditorDefaults(),
            imageReader: createDefaultImageReader({ orientImage: true }),
            imageWriter: createDefaultImageWriter({
              copyImageHead: false, // Remove os metadados da imagem exportada
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
            imageState: this.storedImageState ? JSON.parse(this.storedImageState) : undefined,  // Carrega o estado anterior, se disponível
          };

          // Subscrições ao estado do NgRx
          this.isLoading$ = this.store.select(selectFileUploading);
          this.errorMessage$ = this.store.select(selectFileError);
          this.success$ = this.store.select(selectFileSuccess);
        } else {
          // Trata caso o usuário não esteja autenticado
          this.errorHandler.handleError(new Error('Usuário não autenticado.'));
        }
      },
      error => {
        // Trata erros na obtenção do usuário autenticado
        this.errorHandler.handleError(error);
      }
    );
  }

  // Método chamado quando o usuário processa a imagem no editor
  async handleProcess(event: any): Promise<void> {
    // Cria uma URL segura para a imagem processada
    const objectURL = URL.createObjectURL(event.dest);
    this.result = this.sanitizer.bypassSecurityTrustResourceUrl(objectURL) as SafeUrl;

    // Salva o estado atual da imagem
    const imageStateStr = this.stringifyImageState(event.imageState);
    await this.saveImageState(imageStateStr).catch(error => this.errorHandler.handleError(error));

    // Decide se deve atualizar uma imagem existente ou fazer upload de uma nova
    if (this.isEditMode && this.storedImageUrl && this.photoId) {
      await this.updateStoredFile(event.dest).catch(error => this.errorHandler.handleError(error));
    } else {
      await this.uploadProcessedFile(event.dest).catch(error => this.errorHandler.handleError(error));
    }
  }

  // Upload de uma nova imagem processada
  async uploadProcessedFile(processedFile: Blob): Promise<void> {
    if (!this.userId) {
      this.errorHandler.handleError(new Error('Usuário não autenticado.'));
      return;
    }

    const fileName = `${Date.now()}_${this.imageFile.name}`;
    const path = `user_profiles/${this.userId}/${fileName}`;
    const file = new File([processedFile], fileName, { type: this.imageFile.type });

    // Despacha a ação para iniciar o upload
    this.store.dispatch(uploadStart({ file, path, userId: this.userId, fileName }));

    // Aguarda o sucesso do upload
    const success = await firstValueFrom(this.success$);
    if (success) {
      // Obtém a URL de download
      const downloadUrl = await firstValueFrom(this.store.select(selectFileDownloadUrl));

      // Gera um ID para a foto
      const photoId = Date.now().toString();

      // Salva os metadados da foto no Firestore
      await this.photoFirestoreService.savePhotoMetadata(this.userId, {
        id: photoId,
        url: downloadUrl!,
        fileName: fileName,
        createdAt: new Date()
      });

      // Fecha o modal e notifica o usuário
      this.activeModal.close('uploadSuccess');
      this.errorNotifier.showSuccess('Imagem enviada com sucesso!');
    }
  }

  // Atualiza uma imagem existente no storage
  async updateStoredFile(processedFile: Blob): Promise<void> {
    if (!this.userId || !this.storedImageUrl || !this.photoId) {
      this.errorHandler.handleError(new Error('Informações incompletas para a substituição da foto.'));
      return;
    }

    const filePath = this.storedImageUrl;
    const file = new File([processedFile], `edited_${this.imageFile.name}`, { type: this.imageFile.type });

    try {
      // Substitui o arquivo existente no storage
      const downloadUrl = await lastValueFrom(this.storageService.replaceFile(file, filePath));

      // Atualiza os metadados da foto no Firestore
      await this.photoFirestoreService.updatePhotoMetadata(this.userId, this.photoId, { url: downloadUrl });

      // Fecha o modal e notifica o usuário
      this.activeModal.close('updateSuccess');
      this.errorNotifier.showSuccess('Imagem atualizada com sucesso!');
    } catch (error: any) {
      this.errorHandler.handleError(error);
    }
  }

  // Salva o estado da imagem
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

  // Converte o estado da imagem para uma string JSON
  stringifyImageState(imageState: PinturaImageState): string {
    return JSON.stringify(imageState, (k, v) => (v === undefined ? null : v));
  }

  // Converte uma string JSON para o estado da imagem
  parseImageState(str: string): PinturaImageState {
    return JSON.parse(str);
  }
}
