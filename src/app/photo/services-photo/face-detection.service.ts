//src\app\photo\services-photo\face-detection.service.ts
import { Injectable } from '@angular/core';
import * as blazeface from '@tensorflow-models/blazeface';

@Injectable({
  providedIn: 'root'
})
export class FaceDetectionService {
  private model: any;

  async loadModel(): Promise<void> {
    this.model = await blazeface.load();
  }

  async detectFaces(canvas: HTMLCanvasElement): Promise<any[]> {
    if (!this.model) {
      await this.loadModel();
    }
    return this.model.estimateFaces(canvas, false);
  }
}
