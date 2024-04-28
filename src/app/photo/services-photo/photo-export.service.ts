// src/app/photo/services-photo/photo-export.service.ts
import { Injectable } from '@angular/core';
import { fabric } from 'fabric';

@Injectable({
  providedIn: 'root'
})
export class PhotoExportService {

  constructor() { }

  exportAsDataURL(canvas: fabric.Canvas, options?: { format: string, quality: number }): string {
    return canvas.toDataURL(options);
  }

  async exportAsBlob(canvas: fabric.Canvas, options?: { format: string, quality: number }): Promise<Blob | null> {
    return new Promise(resolve => {
      const domCanvas = canvas.getElement() as HTMLCanvasElement; // Obtém o canvas DOM
      domCanvas.toBlob(blob => {
        resolve(blob);
      }, options?.format ?? 'image/png', options?.quality ?? 1);
    });
  }


  // Você pode adicionar mais métodos para suportar diferentes formatos de exportação ou destinos (como salvar no servidor)
}
