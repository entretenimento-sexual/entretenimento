//src\app\photo\services-photo\image-processing.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ImageProcessingService {

  constructor() { }

  /**
   * Método público para redimensionar qualquer imagem para dimensões específicas.
   *
   * @param file Arquivo da imagem a ser redimensionada.
   * @param width Largura desejada para a imagem.
   * @param height Altura desejada para a imagem.
   * @returns Uma Promise que resolve com a URL da imagem redimensionada.
   */
  public redimensionarImagem(file: File, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        let newWidth = width;
        let newHeight = height;

        // Ajusta as dimensões para manter a proporção da imagem original
        if (aspectRatio > 1) {
          // Imagem mais larga que alta
          newHeight = newWidth / aspectRatio;
        } else if (aspectRatio < 1) {
          // Imagem mais alta que larga
          newWidth = newHeight * aspectRatio;
        }

        // Cria um canvas para realizar o redimensionamento
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Não foi possível obter o contexto do canvas.'));
        }

        // Desenha a imagem no canvas com as novas dimensões
        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        // Converte o canvas para blob e então para URL
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

  ajustarBrilho(file: File, valorBrilho: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas); // CamanJS precisa que o canvas esteja no DOM
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        Caman(canvas, function () {
          this.brightness(valorBrilho);
          this.render(() => {
            canvas.toBlob(blob => {
              if (blob) {
                resolve(URL.createObjectURL(blob));
              } else {
                reject(new Error('Falha ao ajustar brilho da imagem.'));
              }
            }, file.type);
          });
        });
      };
      img.onerror = () => reject(new Error('Erro ao carregar imagem.'));
    });
  }

  // Você pode adicionar mais métodos aqui conforme necessário
  // Por exemplo, métodos para ajustar brilho, contraste, etc.
}
