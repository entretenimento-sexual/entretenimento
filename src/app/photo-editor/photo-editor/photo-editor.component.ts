// src/app/photo-editor/photo-editor/photo-editor.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { PinturaEditorOptions, getEditorDefaults, createDefaultImageReader, createDefaultImageWriter } from '@pqina/pintura';

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

  constructor(private sanitizer: DomSanitizer) { }

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
    } catch (error) {
      console.error('Erro ao processar a imagem:', error);
    }
  }
}
