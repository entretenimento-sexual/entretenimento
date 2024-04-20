//src\app\photo\services-photo\image-processing.service.ts
import { Injectable } from '@angular/core';
import { fabric } from 'fabric';


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
      const reader = new FileReader();
      reader.onload = (event: any) => {
        const imgElement = new Image();
        imgElement.src = event.target.result;
        imgElement.onload = () => {
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

          // Agora, pegando diretamente a string do Data URL
          resolve(canvas.toDataURL({
            format: 'png',
            quality: 1
          }));
        };
      };
      reader.onerror = (error) => reject(new Error('Erro ao carregar imagem.'));
      reader.readAsDataURL(file);
    });
  }
  // Você pode adicionar mais métodos aqui conforme necessário
  // Por exemplo, métodos para ajustar brilho, contraste, etc.
}
