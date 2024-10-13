// src/app/photo-editor/photo-editor/photo-editor.component.ts
import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { PinturaEditorOptions, getEditorDefaults, createDefaultImageReader, createDefaultImageWriter, PinturaImageState } from '@pqina/pintura';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import * as locale_pt_br from '@pqina/pintura/locale/pt_PT';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GlobalErrorHandler } from 'src/app/core/services/error-handler/global-error-handler.service';
import { HttpErrorResponse } from '@angular/common/http';

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
  @ViewChild('editor') editor: any;

  src!: string;
  options!: PinturaEditorOptions;
  result?: SafeUrl;
  isLoading = false;
  errorMessage: string = '';
  userId!: string;

  constructor(
    private sanitizer: DomSanitizer,
    private storageService: StorageService,
    private photoFirestoreService: PhotoFirestoreService,
    public activeModal: NgbActiveModal,
    private authService: AuthService,
    private errorHandler: GlobalErrorHandler
  ) { }

  ngOnInit(): void {
    try {
      this.authService.getUserAuthenticated().subscribe(user => {
        if (user && user.uid) {
          this.userId = user.uid;

          if (this.storedImageUrl) {
            // Se a URL da imagem armazenada estiver disponível, carregue-a no editor
            this.src = this.storedImageUrl;
          } else if (this.imageFile) {
            // Caso contrário, carregue o arquivo local
            this.src = URL.createObjectURL(this.imageFile);
          }

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
        } else {
          throw new Error('Usuário não autenticado.');
        }
      });
    } catch (error) {
      console.error('Erro ao inicializar o PhotoEditorComponent:', error);
      this.errorMessage = 'Erro ao carregar o editor de imagens. Tente novamente.';
    }
  }

  async handleProcess(event: any): Promise<void> {
    try {
      this.isLoading = true;
      this.errorMessage = '';

      const objectURL = URL.createObjectURL(event.dest);
      this.result = this.sanitizer.bypassSecurityTrustResourceUrl(objectURL) as SafeUrl;

      // Salvar o estado da imagem
      const imageStateStr = this.stringifyImageState(event.imageState);
      this.saveImageState(imageStateStr);

      // Fazer o upload do arquivo processado
      if (this.isEditMode && this.storedImageUrl && this.photoId) {
        await this.updateStoredFile(event.dest); // Substitui a imagem existente
      } else {
        await this.uploadProcessedFile(event.dest); // Carrega uma nova imagem
      }
    } catch (error: unknown) {
      // Converte qualquer tipo de erro para Error, garantindo que o GlobalErrorHandler aceite
      const castedError = error instanceof Error ? error : new Error('Erro desconhecido');

      // Passa o erro convertido para o GlobalErrorHandler
      this.errorHandler.handleError(castedError);

      this.errorMessage = 'Ocorreu um erro ao processar a imagem. Tente novamente.';
    } finally {
      this.isLoading = false;
    }
  }

  // Upload de uma nova imagem processada
  async uploadProcessedFile(processedFile: Blob): Promise<void> {
    try {
      if (!this.userId) {
        throw new Error('Usuário não autenticado.');
      }

      const fileName = `${Date.now()}_${this.imageFile.name}`;
      const path = `user_profiles/${this.userId}/${fileName}`;

      const downloadUrl = await this.storageService.uploadFile(
        new File([processedFile], fileName, { type: this.imageFile.type }),
        path,
        this.userId
      ).toPromise(); // Use toPromise para converter o Observable em Promise
      console.log('Imagem enviada com sucesso:', downloadUrl);
      this.activeModal.close('uploadSuccess');
    } catch (error) {
      this.errorHandler.handleError(error as Error); // Convertendo para o tipo esperado
      this.errorMessage = 'Erro ao atualizar a imagem armazenada. Tente novamente.';
    }
  }

  // Substitui uma imagem existente no storage
  async updateStoredFile(processedFile: Blob): Promise<void> {
    try {
      if (!this.userId || !this.storedImageUrl || !this.photoId) {
        throw new Error('Informações incompletas para a substituição da foto.');
      }

      const filePath = this.storedImageUrl;
      const downloadUrl = await this.storageService.replaceFile(
        new File([processedFile], `edited_${this.imageFile.name}`, { type: this.imageFile.type }),
        filePath
      ).toPromise(); // Converte o Observable em Promise

      await this.photoFirestoreService.updatePhotoMetadata(this.userId, this.photoId, { url: downloadUrl });
      this.activeModal.close('updateSuccess');
    } catch (error) {
      this.errorHandler.handleError(error); // Tratamento de erro
      this.errorMessage = 'Erro ao atualizar a imagem armazenada. Tente novamente.';
    }
  }

  // Salva o estado da imagem
  saveImageState(imageStateStr: string): void {
    if (!this.userId) {
      this.errorHandler.handleError(new Error('Usuário não autenticado.'));
      return;
    }
    this.photoFirestoreService.saveImageState(this.userId, imageStateStr).catch(error => {
      this.errorHandler.handleError(error); // Tratamento de erro ao salvar o estado da imagem
    });
  }

  stringifyImageState(imageState: PinturaImageState): string {
    return JSON.stringify(imageState, (k, v) => (v === undefined ? null : v));
  }

  parseImageState(str: string): PinturaImageState {
    return JSON.parse(str);
  }
}
