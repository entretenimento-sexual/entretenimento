// src/app/photo-editor/photo-editor/photo-editor.component.ts
import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { PinturaEditorOptions, getEditorDefaults, createDefaultImageReader, createDefaultImageWriter, PinturaImageState } from '@pqina/pintura';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import locale_pt_br from '@pqina/pintura/locale/pt_PT';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit {
  @Input() imageFile!: File;
  @Input() storedImageState?: string;
  @ViewChild('editor') editor: any;

  src!: string;
  options!: PinturaEditorOptions;
  result?: SafeUrl;
  isLoading = false; // Flag para indicar o processamento
  errorMessage: string = ''; // Mensagem de erro para feedback ao usuário

  constructor(
    private sanitizer: DomSanitizer,
    private storageService: StorageService,
    private firestoreService: FirestoreService,
    public activeModal: NgbActiveModal
  ) { }

  ngOnInit(): void {
    try {
      if (!this.imageFile || !(this.imageFile instanceof File)) {
        throw new Error('imageFile não é um objeto File válido.');
      }

      this.src = URL.createObjectURL(this.imageFile);

      this.options = {
        ...getEditorDefaults(),
        imageReader: createDefaultImageReader({ orientImage: true }), // Corrige a orientação da imagem
        imageWriter: createDefaultImageWriter({
          copyImageHead: false, // Remove os metadados da imagem exportada
          quality: 0.8
        }), // Configura a qualidade da imagem
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
    } catch (error) {
      console.error('Erro ao inicializar o PhotoEditorComponent:', error);
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
      await this.uploadProcessedFile(event.dest);

    } catch (error) {
      console.error('Erro ao processar a imagem:', error);
      this.errorMessage = 'Ocorreu um erro ao processar a imagem. Tente novamente.';
    } finally {
      this.isLoading = false;
    }
  }

  async uploadProcessedFile(processedFile: Blob): Promise<void> {
    try {
      const uid = 'user_uid_aqui';  // Substitua isso pelo UID real do usuário
      const fileName = `${Date.now()}_${this.imageFile.name}`;
      const path = `user_profiles/${uid}/${fileName}`;

      const downloadUrl = await this.storageService.uploadFile(new File([processedFile], fileName, { type: this.imageFile.type }), path);
      console.log('Imagem enviada com sucesso:', downloadUrl);

      this.activeModal.close('uploadSuccess');
    } catch (error) {
      console.error('Erro ao fazer upload da imagem editada:', error);
      this.errorMessage = 'Erro ao enviar a imagem para o servidor. Tente novamente.';
    }
  }

  saveImageState(imageStateStr: string): void {
    this.firestoreService.saveImageState('user_uid_aqui', imageStateStr);
  }

  stringifyImageState(imageState: PinturaImageState): string {
    return JSON.stringify(imageState, (k, v) => (v === undefined ? null : v));
  }

  parseImageState(str: string): PinturaImageState {
    return JSON.parse(str);
  }
}
