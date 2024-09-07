// src/app/core/services/image-handling/photo-service.ts
import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class PhotoService {
  allowedFileTypes: string[] = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
    'image/tiff', 'image/svg+xml', 'image/x-icon', 'image/heic', 'image/heif'
  ];

  maxSizeInMB = 5;
  minSizeInKB = 100;

  async processFile(file: File): Promise<File> {
    if (!this.allowedFileTypes.includes(file.type)) {
      throw new Error('Tipo de arquivo não suportado.');
    }

    if (file.size / 1024 < this.minSizeInKB) {
      throw new Error(`A imagem é muito pequena. O tamanho mínimo é de ${this.minSizeInKB} KB.`);
    }

    if (file.size / 1024 / 1024 > this.maxSizeInMB) {
      const options = {
        maxSizeMB: this.maxSizeInMB,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      };
      const compressedBlob = await imageCompression(file, options);
      return new File([compressedBlob], file.name, { type: file.type, lastModified: Date.now() });
    } else {
      return file;
    }
  }
}
