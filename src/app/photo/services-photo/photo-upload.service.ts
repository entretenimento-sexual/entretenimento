// src/app/photo/services-photo/photo-upload.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PhotoUploadService {
  uploadPhoto(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      // Implementar a lógica de upload, por exemplo, usando HttpClient
      // Simulação de upload bem-sucedido
      setTimeout(() => resolve('URL da foto enviada'), 2000);
    });
  }
}
