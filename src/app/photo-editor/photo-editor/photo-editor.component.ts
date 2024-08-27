// src/app/photo-editor/photo-editor/photo-editor.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'; // Se você estiver usando modais do Bootstrap
import { PinturaEditorOptions, getEditorDefaults, createDefaultImageReader, createDefaultImageWriter } from '@pqina/pintura';
import { StorageService } from 'src/app/core/services/image-handling/storage.service'; // Certifique-se de importar o StorageService

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit {
  @Input() imageFile!: File;
  src!: string;
  options!: PinturaEditorOptions;
  result?: SafeUrl;

  constructor(
              private sanitizer: DomSanitizer,
              private storageService: StorageService,
              public activeModal: NgbActiveModal  
              ) { }

  ngOnInit(): void {
    try {
      if (!this.imageFile || !(this.imageFile instanceof File)) {
        throw new Error('imageFile não é um objeto File válido.');
      }

      // Crie uma URL de objeto para o arquivo de imagem
      this.src = URL.createObjectURL(this.imageFile);

      this.options = {
        ...getEditorDefaults(),
        imageReader: createDefaultImageReader(),
        imageWriter: createDefaultImageWriter(),
        locale: {
          ...getEditorDefaults().locale,
          labelButtonExport: 'Salvar',
          labelButtonClose: 'Fechar',
        },
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
        imageCropAspectRatio: undefined,  // Permite corte livre
        imageCrop: undefined,  // Desativa o corte inicial para visualizar toda a imagem
        imageCropLimitToImage: false,  // Permite cortar fora da imagem
        imageBackgroundColor: [255, 255, 255, 0],  // Fundo transparente
      };
    } catch (error) {
      console.error('Erro ao inicializar o PhotoEditorComponent:', error);
    }
  }

  handleProcess(event: any): void {
    try {
      const objectURL = URL.createObjectURL(event.dest);
      this.result = this.sanitizer.bypassSecurityTrustResourceUrl(objectURL) as SafeUrl;

      // Agora, chame o método para enviar a imagem processada para o storage
      this.uploadProcessedFile(event.dest);
    } catch (error) {
      console.error('Erro ao processar a imagem:', error);
    }
  }

  async uploadProcessedFile(processedFile: Blob): Promise<void> {
    try {
      // Gere um nome de arquivo único, por exemplo, com base no UID do usuário ou timestamp
      const uid = 'user_uid_aqui';  // Substitua isso pelo UID real do usuário
      const fileName = `${Date.now()}_${this.imageFile.name}`;
      const path = `user_profiles/${uid}/${fileName}`;

      const downloadUrl = await this.storageService.uploadFile(new File([processedFile], fileName, { type: this.imageFile.type }), path);
      console.log('Imagem enviada com sucesso:', downloadUrl);

      // Agora, você pode fechar o modal ou notificar o usuário de que o upload foi concluído
      this.activeModal.close('uploadSuccess'); // Se estiver usando modais do Bootstrap
    } catch (error) {
      console.error('Erro ao fazer upload da imagem editada:', error);
    }
  }
}
