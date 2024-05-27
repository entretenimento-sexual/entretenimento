// src\app\photo\services-photo\face-detection.service.ts
import { Injectable } from '@angular/core';
import * as blazeface from '@tensorflow-models/blazeface';
import { PhotoErrorHandlerService } from './photo-error-handler.service';

@Injectable({
  providedIn: 'root'
})
export class FaceDetectionService {
  private model: blazeface.BlazeFaceModel | null = null;

  constructor(private errorHandler: PhotoErrorHandlerService) {
    this.loadModel().catch(error => this.errorHandler.handleError(error as Error));
  }

  private async loadModel(): Promise<void> {
    try {
      if (!this.model) {
        this.model = await blazeface.load();
      }
    } catch (error) {
      this.errorHandler.handleError(error as Error);
      throw new Error('Falha ao carregar o modelo de detecção de rostos');
    }
  }

  public async detectFaces(canvas: HTMLCanvasElement): Promise<blazeface.NormalizedFace[]> {
    try {
      if (!this.model) {
        await this.loadModel();
      }

      // Verificação para garantir que o modelo não é nulo
      if (this.model) {
        return this.model.estimateFaces(canvas, false);
      } else {
        throw new Error('O modelo de detecção de rostos não está disponível');
      }
    } catch (error) {
      this.errorHandler.handleError(error as Error);
      throw new Error('Falha ao detectar rostos');
    }
  }
}
