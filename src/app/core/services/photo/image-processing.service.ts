//src\app\core\services\photo\image-processing.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ImageProcessingService {

  constructor() { }

  redimensionarImagem200x200(file: File): Promise<string> {
    return this.redimensionarImagem(file, 200, 200);
  }

  private redimensionarImagem(file: File, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        let newWidth = width;
        let newHeight = height;

        if (aspectRatio > 1) {
          newHeight = newWidth / aspectRatio;
        } else if (aspectRatio < 1) {
          newWidth = newHeight * aspectRatio;
        }

        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Não foi possível obter o contexto do canvas.'));
        }
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        canvas.toBlob(blob => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            reject(new Error('Falha ao redimensionar imagem.'));
          }
        }, file.type);
      };
      img.onerror = () => reject(new Error('Erro ao carregar imagem.'));
    });
  }
}