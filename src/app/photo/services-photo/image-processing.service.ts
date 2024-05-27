// src\app\photo\services-photo\image-processing.service.ts
import { Injectable } from '@angular/core';
import { fabric } from 'fabric';
import { PhotoErrorHandlerService } from './photo-error-handler.service';

@Injectable({
  providedIn: 'root'
})
export class ImageProcessingService {

  constructor(private errorHandler: PhotoErrorHandlerService) { }

  public redimensionarImagem(file: File, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const aspectRatio = img.width / img.height;
          let newWidth = width;
          let newHeight = height;

          if (aspectRatio > 1) {
            newHeight = Math.round(width / aspectRatio);
          } else if (aspectRatio < 1) {
            newWidth = Math.round(height * aspectRatio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Não foi possível obter o contexto do canvas.');
          }

          ctx.drawImage(img, 0, 0, newWidth, newHeight);

          canvas.toBlob(blob => {
            if (blob) {
              resolve(URL.createObjectURL(blob));
            } else {
              throw new Error('Falha ao redimensionar imagem.');
            }
          }, file.type);
        } catch (error) {
          this.errorHandler.handleError(error as Error);
          reject(error);
        }
      };

      img.onerror = (error) => {
        const err = new Error('Erro ao carregar imagem.');
        this.errorHandler.handleError(err);
        reject(err);
      };
    });
  }

  public ajustarBrilho(file: File, valorBrilho: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event: any) => {
        const imgElement = new Image();
        imgElement.src = event.target.result;
        imgElement.onload = () => {
          try {
            const canvas = new fabric.Canvas(document.createElement('canvas'));
            canvas.setHeight(imgElement.height);
            canvas.setWidth(imgElement.width);
            const fabricImage = new fabric.Image(imgElement);
            canvas.add(fabricImage);

            fabricImage.filters ??= [];
            fabricImage.filters.push(new fabric.Image.filters.Brightness({
              brightness: valorBrilho
            }));
            fabricImage.applyFilters();
            canvas.renderAll();

            resolve(canvas.toDataURL({
              format: 'png',
              quality: 1
            }));
          } catch (error) {
            this.errorHandler.handleError(error as Error);
            reject(error);
          }
        };

        imgElement.onerror = (error) => {
          const err = new Error('Erro ao carregar imagem.');
          this.errorHandler.handleError(err);
          reject(err);
        };
      };
      reader.onerror = (error) => {
        const err = new Error('Erro ao carregar imagem.');
        this.errorHandler.handleError(err);
        reject(err);
      };
      reader.readAsDataURL(file);
    });
  }
}
